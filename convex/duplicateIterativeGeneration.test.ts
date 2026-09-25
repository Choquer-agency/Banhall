/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import * as projectsModule from "./projects";
import { buildTiptapDocument } from "./lib/tiptapReport";

/**
 * Duplicate from a project card (2026-09-25). The card opens
 * /project/new?from=<id>&drafts=iterative and the wizard then runs, in
 * order: createProject (transcripts copied by reference),
 * copyProjectContent with `includeReport: false` and `includeReviews: false`
 * (inputs only), and requestGeneration in Step by step mode, exactly as for a
 * new project. The old dashboard's plain `?from=` link runs the same two
 * copy steps with no options (a full clone) and starts nothing.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "duplicate-iterative-writer";

const SOURCE_TRANSCRIPT =
  "Interviewer: What could you not predict?\nEngineer: How the new alloy would crack under repeated heating.";
const SOURCE_NOTES = "Writer's notes: the cracking tests are the real uncertainty.";
const ARCHIVED_NOTES = "Old scoping notes that were archived.";
const REVIEWED_PD = "The written PD a reviewer looked at last year.";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  // Hold scheduled functions. createProject schedules the copied
  // transcript's turn build and fact copy, and requestGeneration its start,
  // at runAfter(0). Under real timers convex-test runs them while the copy
  // action is still storing files, and its single in-memory store then
  // fails the action's write ("Write outside of transaction"). A deployment
  // runs them independently: the build and the copy write different
  // fields. Nothing here reads what they write. Date stays real.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const sourceProjectId = await ctx.db.insert("projects", {
      title: "Alloy furnace",
      clientName: "Forgeworks Inc.",
      status: "review",
      mode: "generate",
      createdBy: userId,
      ownerId: userId,
      workflowStage: "drafting",
      shareToken: "duplicate-iterative-token",
      createdAt: now,
      updatedAt: now,
    });
    const sourceTranscriptId = await ctx.db.insert("transcripts", {
      projectId: sourceProjectId,
      label: "Kickoff interview.docx",
      position: 0,
      content: SOURCE_TRANSCRIPT,
      createdAt: now,
    });
    const notesStorageId = await ctx.storage.store(new Blob([SOURCE_NOTES]));
    const notesId = await ctx.db.insert("projectDocuments", {
      projectId: sourceProjectId,
      fileName: "Writer notes.md",
      fileType: "md",
      content: SOURCE_NOTES,
      storageId: notesStorageId,
      category: "writer_notes",
      source: "context_input",
      uploadedBy: "Writer",
      uploaderRole: "writer",
      createdAt: now,
    });
    await ctx.db.insert("projectDocuments", {
      projectId: sourceProjectId,
      fileName: "Old scoping.md",
      fileType: "md",
      content: ARCHIVED_NOTES,
      category: "scoping_notes",
      archived: true,
      source: "context_input",
      uploadedBy: "Writer",
      uploaderRole: "writer",
      createdAt: now,
    });
    const reviewedPdId = await ctx.db.insert("projectDocuments", {
      projectId: sourceProjectId,
      fileName: "Reviewed PD.docx",
      fileType: "docx",
      content: REVIEWED_PD,
      source: "review_pd",
      uploadedBy: "Writer",
      uploaderRole: "writer",
      createdAt: now,
    });
    await ctx.db.insert("pdReviews", {
      projectId: sourceProjectId,
      documentId: reviewedPdId,
      sourceFileName: "Reviewed PD.docx",
      status: "completed",
      result: "review output",
      createdBy: "Writer",
      createdAt: now,
      completedAt: now,
    });
    await ctx.db.insert("projectIdentityEvidence", {
      projectId: sourceProjectId,
      subjectName: "Forgeworks Inc.",
      relationship: "claimant",
      evidenceKind: "project_document",
      projectDocumentId: notesId,
      sourceDescription: "Writer notes.md",
      status: "verified",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("reports", {
      projectId: sourceProjectId,
      content: "<p>Last year's draft.</p>",
      version: 1,
      generatedAt: now,
      updatedAt: now,
      sourceTranscriptId,
    });
    return { userId, sourceProjectId, sourceTranscriptId, notesStorageId, notesId, reviewedPdId };
  });
  return { t, writer: t.withIdentity({ subject: authId }), ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/**
 * The wizard's duplicate commit, minus the browser. `scope` is what the
 * card Duplicate passes; the plain `?from=` link passes nothing.
 */
type CopyScope = {
  includeReport?: boolean;
  includeReviews?: boolean;
  excludeDocumentIds?: Id<"projectDocuments">[];
  previousYearReport?: boolean;
};

async function duplicateLikeTheWizard(
  f: Fixture,
  scope: CopyScope = {},
  create: { fiscalYearEnd?: number; mode?: "generate" | "review" } = {}
) {
  const { projectId, transcriptIds } = await f.writer.mutation(api.projects.createProject, {
    title: "Alloy furnace (copy)",
    clientName: "Forgeworks Inc.",
    mode: "generate",
    transcripts: [{ fromTranscriptId: f.sourceTranscriptId, label: "Kickoff interview.docx" }],
    ...create,
  });
  const copied = await f.writer.action(api.projectDuplication.copyProjectContent, {
    fromProjectId: f.sourceProjectId,
    toProjectId: projectId,
    ...(transcriptIds[0] ? { targetTranscriptId: transcriptIds[0] } : {}),
    ...scope,
  });
  return { projectId, transcriptIds, copied };
}

async function projectRows(f: Fixture, projectId: Id<"projects">) {
  return await f.t.run(async (ctx) => ({
    project: await ctx.db.get(projectId),
    reports: await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
    documents: await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
    reviews: await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
    evidence: await ctx.db
      .query("projectIdentityEvidence")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
    generations: await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
  }));
}

async function frozenSources(f: Fixture, generationId: Id<"generations">) {
  return await f.t.run((ctx) =>
    ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .collect()
  );
}

describe("a card duplicate made to draft Step by step", () => {
  it("copies the inputs but not the report, then drafts from the copied transcript", async () => {
    const f = await setup();
    const { projectId, transcriptIds, copied } = await duplicateLikeTheWizard(f, {
      includeReport: false,
      includeReviews: false,
    });

    // Inputs only: the notes and the archived notes (with their evidence),
    // no report, no PD review and no reviewed PD.
    expect(copied).toMatchObject({
      documentsCopied: 2,
      filesCopied: 1,
      evidenceCopied: 1,
      pdReviewsCopied: 0,
      reportCopied: false,
    });
    const before = await projectRows(f, projectId);
    expect(before.reports).toEqual([]);
    expect(before.reviews).toEqual([]);
    expect(before.documents.map((document) => document.fileName).sort()).toEqual([
      "Old scoping.md",
      "Writer notes.md",
    ]);
    expect(before.evidence).toHaveLength(1);
    // The original file is cloned, never shared with the source.
    const copiedNotes = before.documents.find((document) => document.fileName === "Writer notes.md");
    expect(copiedNotes?.storageId).toBeTruthy();
    expect(copiedNotes?.storageId).not.toBe(f.notesStorageId);
    const copiedBytes = await f.t.run(async (ctx) => {
      const blob = copiedNotes?.storageId ? await ctx.storage.get(copiedNotes.storageId) : null;
      return blob ? await blob.text() : null;
    });
    expect(copiedBytes).toBe(SOURCE_NOTES);
    // Nothing copied makes the new project look drafted or busy.
    expect(before.project).toMatchObject({ status: "draft", workflowStage: "intake" });
    expect(before.project?.activeGenerationId).toBeUndefined();
    expect(transcriptIds).toHaveLength(1);
    expect(transcriptIds[0]).not.toBe(f.sourceTranscriptId);

    // Same call as a new project: no regeneration confirmation is needed.
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "iterative",
    });

    const generation = await f.t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({
      projectId,
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      status: "reserved",
      transcriptId: transcriptIds[0],
      transcriptIds,
    });
    const state = await f.writer.query(api.generations.getIterativeState, { generationId });
    expect(state?.gatedWorkflow).toBe("seeds");

    const sources = await frozenSources(f, generationId);
    const transcriptSources = sources.filter((source) => source.kind === "transcript");
    expect(transcriptSources).toHaveLength(1);
    expect(transcriptSources[0]).toMatchObject({
      projectId,
      transcriptId: transcriptIds[0],
      content: SOURCE_TRANSCRIPT,
      truncated: false,
    });
    // The copied notes are read; the archived copy is not, and the reviewed
    // PD was never copied.
    const documentContents = sources
      .filter((source) => source.kind === "project_document")
      .map((source) => source.content);
    expect(documentContents).toEqual([SOURCE_NOTES]);

    // Nothing on the source project moved.
    const source = await projectRows(f, f.sourceProjectId);
    expect(source.generations).toEqual([]);
    expect(source.reports).toHaveLength(1);
    expect(source.reviews).toHaveLength(1);
  });

  it("keeps PD reviews when the duplicate is a Review PD project", async () => {
    const f = await setup();
    const { projectId, copied } = await duplicateLikeTheWizard(f, {
      includeReport: false,
      includeReviews: true,
    });
    expect(copied).toMatchObject({ documentsCopied: 3, pdReviewsCopied: 1, reportCopied: false });
    const rows = await projectRows(f, projectId);
    expect(rows.reports).toEqual([]);
    expect(rows.documents.map((document) => document.fileName)).toContain("Reviewed PD.docx");
  });
});

describe("the plain ?from= duplicate", () => {
  it("still clones the report and reviews and starts nothing", async () => {
    const f = await setup();
    const { projectId, transcriptIds, copied } = await duplicateLikeTheWizard(f);

    expect(copied).toMatchObject({
      documentsCopied: 3,
      evidenceCopied: 1,
      pdReviewsCopied: 1,
      reportCopied: true,
    });
    const rows = await projectRows(f, projectId);
    expect(rows.reports).toHaveLength(1);
    expect(rows.reports[0]).toMatchObject({
      content: "<p>Last year's draft.</p>",
      sourceTranscriptId: transcriptIds[0],
    });
    expect(rows.reviews).toHaveLength(1);
    expect(rows.project?.status).toBe("review");
    expect(rows.generations).toEqual([]);
  });
});

describe("dashboard rows mark a project being deleted", () => {
  it("adds deleting only to a row whose deletion has started", async () => {
    const f = await setup();
    await f.t.run((ctx) =>
      ctx.db.patch(f.sourceProjectId, { deletionStartedAt: Date.now() })
    );
    const { projectId } = await f.writer.mutation(api.projects.createProject, {
      title: "Live project",
      clientName: "Forgeworks Inc.",
      transcripts: [],
    });

    const result = await f.writer.query(api.dashboard.listFlatProjects, {
      paginationOpts: { numItems: 10, cursor: null },
      sortBy: "updated",
    });
    const deleting = result.page.find((row) => row._id === f.sourceProjectId);
    const live = result.page.find((row) => row._id === projectId);
    expect(deleting).toMatchObject({ deleting: true });
    expect(live).toBeTruthy();
    expect(live && "deleting" in live).toBe(false);
  });
});

/**
 * Owner decision 35 (2026-09-25): the writer can untick copied files, the
 * copy only writes into a project the caller has just made, a year-over-year
 * duplicate can bring the old report in as last year's report, and
 * transcript original files come along.
 */
const INPUTS_ONLY = { includeReport: false, includeReviews: false } as const;
const FYE_2024 = Date.UTC(2024, 11, 31);
const FYE_2025 = Date.UTC(2025, 11, 31);

async function errorCode(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const data = (error as { data?: { code?: string } }).data;
    return data?.code ?? String(error);
  }
  return "no error";
}

async function newProject(f: Fixture, extra: { fiscalYearEnd?: number } = {}) {
  const { projectId, transcriptIds } = await f.writer.mutation(api.projects.createProject, {
    title: "Alloy furnace (copy)",
    clientName: "Forgeworks Inc.",
    mode: "generate",
    transcripts: [{ fromTranscriptId: f.sourceTranscriptId, label: "Kickoff interview.docx" }],
    ...extra,
  });
  return { projectId, transcriptIds };
}

describe("unticked files stay behind", () => {
  it("leaves out the unticked files, and the evidence tied to them", async () => {
    const f = await setup();
    const { projectId, copied } = await duplicateLikeTheWizard(f, {
      ...INPUTS_ONLY,
      excludeDocumentIds: [f.notesId],
    });
    expect(copied).toMatchObject({ documentsCopied: 1, filesCopied: 0, evidenceCopied: 0 });
    const rows = await projectRows(f, projectId);
    expect(rows.documents.map((document) => document.fileName)).toEqual(["Old scoping.md"]);
    expect(rows.evidence).toEqual([]);
  });

  it("takes a left-out written PD's reviews with it", async () => {
    const f = await setup();
    const { projectId, copied } = await duplicateLikeTheWizard(f, {
      includeReport: false,
      includeReviews: true,
      excludeDocumentIds: [f.reviewedPdId],
    });
    expect(copied).toMatchObject({ documentsCopied: 2, pdReviewsCopied: 0 });
    const rows = await projectRows(f, projectId);
    expect(rows.reviews).toEqual([]);
    expect(rows.documents.map((document) => document.fileName)).not.toContain("Reviewed PD.docx");
  });

  it("copies everything for an empty list", async () => {
    const f = await setup();
    const { projectId, copied } = await duplicateLikeTheWizard(f, {
      ...INPUTS_ONLY,
      excludeDocumentIds: [],
    });
    expect(copied).toMatchObject({ documentsCopied: 2, filesCopied: 1, evidenceCopied: 1 });
    const rows = await projectRows(f, projectId);
    const notes = rows.documents.find((document) => document.fileName === "Writer notes.md");
    expect(notes?.storageId).toBeTruthy();
    expect(notes?.storageId).not.toBe(f.notesStorageId);
  });

  it("refuses a file from another project and writes nothing", async () => {
    const f = await setup();
    const strayId = await f.t.run(async (ctx) => {
      const otherProjectId = await ctx.db.insert("projects", {
        title: "Other",
        clientName: "Other Inc.",
        status: "draft",
        createdBy: f.userId,
        ownerId: f.userId,
        shareToken: "other-token",
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("projectDocuments", {
        projectId: otherProjectId,
        fileName: "Stray.md",
        fileType: "md",
        content: "Not in the source.",
        source: "context_input",
        uploadedBy: "Writer",
        createdAt: 1,
      });
    });
    const { projectId, transcriptIds } = await newProject(f);
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          targetTranscriptId: transcriptIds[0],
          ...INPUTS_ONLY,
          excludeDocumentIds: [strayId],
        })
      )
    ).toBe("INVALID_INPUT");
    const rows = await projectRows(f, projectId);
    expect(rows.documents).toEqual([]);
    expect(rows.evidence).toEqual([]);
  });

  it("ignores a file deleted from the original meanwhile", async () => {
    const f = await setup();
    const deletedId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("projectDocuments", {
        projectId: f.sourceProjectId,
        fileName: "Gone.md",
        fileType: "md",
        content: "Deleted while the wizard was open.",
        source: "context_input",
        uploadedBy: "Writer",
        createdAt: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    const { copied } = await duplicateLikeTheWizard(f, {
      ...INPUTS_ONLY,
      excludeDocumentIds: [deletedId],
    });
    expect(copied).toMatchObject({ documentsCopied: 2 });
  });
});

describe("the copy is internal and only fills a new project", () => {
  it("keeps prepare and finish off the public API, and drops the legacy copy", () => {
    for (const fn of [
      projectsModule.prepareProjectContentCopy,
      projectsModule.finishProjectContentCopy,
    ]) {
      const registered = fn as unknown as { isPublic?: boolean; isInternal?: boolean };
      expect(registered.isInternal).toBe(true);
      expect(registered.isPublic).not.toBe(true);
    }
    expect("copyProjectDocuments" in projectsModule).toBe(false);
  });

  it("refuses a second copy into the same project", async () => {
    const f = await setup();
    const { projectId, transcriptIds } = await duplicateLikeTheWizard(f, INPUTS_ONLY);
    const before = await projectRows(f, projectId);
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          targetTranscriptId: transcriptIds[0],
          ...INPUTS_ONLY,
        })
      )
    ).toBe("INVALID_STATE");
    const after = await projectRows(f, projectId);
    expect(after.documents).toHaveLength(before.documents.length);
    expect(after.evidence).toHaveLength(before.evidence.length);
  });

  it("refuses a target that already has a report", async () => {
    const f = await setup();
    const { projectId } = await newProject(f);
    await f.t.run((ctx) =>
      ctx.db.insert("reports", {
        projectId,
        content: "<p>Existing.</p>",
        version: 1,
        generatedAt: 1,
        updatedAt: 1,
      })
    );
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          ...INPUTS_ONLY,
        })
      )
    ).toBe("INVALID_STATE");
    expect((await projectRows(f, projectId)).documents).toEqual([]);
  });

  it("refuses a project someone else created", async () => {
    const f = await setup();
    const otherTarget = await f.t.run(async (ctx) => {
      const otherUserId = await ctx.db.insert("users", { authId: "someone-else", role: "writer" });
      return await ctx.db.insert("projects", {
        title: "Someone else's project",
        clientName: "Forgeworks Inc.",
        status: "draft",
        createdBy: otherUserId,
        ownerId: otherUserId,
        shareToken: "someone-else-token",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: otherTarget,
          ...INPUTS_ONLY,
        })
      )
    ).toBe("NOT_AUTHORIZED");
    expect((await projectRows(f, otherTarget)).documents).toEqual([]);
  });
});

describe("last year's report", () => {
  const REPORT = JSON.stringify(
    buildTiptapDocument(
      "Alloy furnace",
      "Whether the alloy would crack under repeated heating.",
      "We ran heating cycles on test bars.",
      "We learned the crack threshold."
    )
  );

  async function setupWithFiscalYear() {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.sourceProjectId, { fiscalYearEnd: FYE_2024 });
      const report = await ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", f.sourceProjectId))
        .first();
      if (report) await ctx.db.patch(report._id, { content: REPORT, version: 3 });
    });
    return f;
  }

  it("tells the wizard the report's version and whether it has text, not the report", async () => {
    const f = await setupWithFiscalYear();
    expect(
      await f.writer.query(api.projects.getDuplicateSourceReport, { projectId: f.sourceProjectId })
    ).toEqual({ version: 3, hasText: true });
    const { projectId } = await newProject(f);
    expect(await f.writer.query(api.projects.getDuplicateSourceReport, { projectId })).toBeNull();
    expect(
      await f.t.query(api.projects.getDuplicateSourceReport, { projectId: f.sourceProjectId })
    ).toBeNull();
  });

  it("brings the old report in as a previous-year file for a later fiscal year", async () => {
    const f = await setupWithFiscalYear();
    const { projectId, copied } = await duplicateLikeTheWizard(
      f,
      { ...INPUTS_ONLY, previousYearReport: true },
      { fiscalYearEnd: FYE_2025 }
    );
    expect(copied).toMatchObject({ reportCopied: false, previousYearReportCopied: true });
    const rows = await projectRows(f, projectId);
    expect(rows.reports).toEqual([]);
    const previous = rows.documents.filter((document) => document.category === "previous_pd");
    expect(previous).toHaveLength(1);
    expect(previous[0]).toMatchObject({
      fileName: "Alloy furnace (report v3, FY 2024).txt",
      fileType: "txt",
      source: "context_input",
      uploaderRole: "writer",
      processingStatus: "ready",
    });
    expect(previous[0].storageId).toBeUndefined();
    expect(previous[0].content.startsWith("[Previous-year report — fiscal 2024]\n\n")).toBe(true);
    expect(previous[0].content).toContain("Whether the alloy would crack under repeated heating.");
    expect(previous[0].content).not.toContain('"type"');

    // A draft reads it as a previous-year report.
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "iterative",
    });
    const labels = (await frozenSources(f, generationId))
      .filter((source) => source.kind === "project_document")
      .map((source) => source.label);
    expect(labels).toContain("previous_pd:Alloy furnace (report v3, FY 2024).txt");
  });

  it.each([
    ["the same fiscal year", { fiscalYearEnd: FYE_2024 }, INPUTS_ONLY],
    ["no fiscal year", {}, INPUTS_ONLY],
    ["the report copied as the report", { fiscalYearEnd: FYE_2025 }, { includeReport: true }],
  ] as const)("is refused for %s", async (_label, create, scope) => {
    const f = await setupWithFiscalYear();
    const { projectId } = await newProject(f, create);
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          ...scope,
          previousYearReport: true,
        })
      )
    ).toBe("INVALID_INPUT");
    const rows = await projectRows(f, projectId);
    expect(rows.documents).toEqual([]);
    expect(rows.reports).toEqual([]);
  });
});

describe("transcript original files", () => {
  it("clones the original file of each copied transcript", async () => {
    const f = await setup();
    const originalStorageId = await f.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["docx bytes"]));
      await ctx.db.patch(f.sourceTranscriptId, { originalStorageId: storageId });
      return storageId;
    });
    const { transcriptIds, copied } = await duplicateLikeTheWizard(f, INPUTS_ONLY);
    expect(copied).toMatchObject({ transcriptOriginalsCopied: 1 });
    const copiedRow = await f.t.run((ctx) => ctx.db.get(transcriptIds[0]));
    expect(copiedRow?.originalStorageId).toBeTruthy();
    expect(copiedRow?.originalStorageId).not.toBe(originalStorageId);
    const bytes = await f.t.run(async (ctx) => {
      const blob = copiedRow?.originalStorageId
        ? await ctx.storage.get(copiedRow.originalStorageId)
        : null;
      return blob ? await blob.text() : null;
    });
    expect(bytes).toBe("docx bytes");
  });

  it("clones nothing for a transcript that was left unticked", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["docx bytes"]));
      await ctx.db.patch(f.sourceTranscriptId, { originalStorageId: storageId });
    });
    const { projectId } = await f.writer.mutation(api.projects.createProject, {
      title: "Alloy furnace (copy)",
      clientName: "Forgeworks Inc.",
      mode: "generate",
      transcripts: [],
    });
    const copied = await f.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: f.sourceProjectId,
      toProjectId: projectId,
      ...INPUTS_ONLY,
    });
    expect(copied).toMatchObject({ transcriptOriginalsCopied: 0 });
  });
});

/** Every stored file, so a test can see what a copy left behind. */
async function storedFileIds(f: Fixture) {
  return await f.t.run(async (ctx) =>
    (await ctx.db.system.query("_storage").collect()).map((file) => file._id)
  );
}

describe("the copy checks what it writes into (review D-7, D-11)", () => {
  it("refuses a report source transcript from another project", async () => {
    const f = await setup();
    const { projectId } = await newProject(f);
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          // The source's own transcript, not the new project's copy.
          targetTranscriptId: f.sourceTranscriptId,
        })
      )
    ).toBe("INVALID_INPUT");
    const rows = await projectRows(f, projectId);
    expect(rows.documents).toEqual([]);
    expect(rows.reports).toEqual([]);
  });

  it("refuses a new project that is already drafting", async () => {
    const f = await setup();
    const { projectId, transcriptIds } = await newProject(f);
    await f.t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId,
        transcriptId: transcriptIds[0],
        status: "running",
        startedAt: Date.now(),
      })
    );
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          targetTranscriptId: transcriptIds[0],
        })
      )
    ).toBe("INVALID_STATE");
    const rows = await projectRows(f, projectId);
    expect(rows.documents).toEqual([]);
    expect(rows.reports).toEqual([]);
  });
});

describe("the leave-out list cap (review D-5)", () => {
  async function sourceWithFiles(f: Fixture, count: number) {
    return await f.t.run(async (ctx) => {
      const ids: Id<"projectDocuments">[] = [];
      for (let index = 0; index < count; index += 1) {
        ids.push(
          await ctx.db.insert("projectDocuments", {
            projectId: f.sourceProjectId,
            fileName: `Note ${index}.md`,
            fileType: "md",
            content: `Note ${index}`,
            source: "context_input",
            uploadedBy: "Writer",
            createdAt: 1,
          })
        );
      }
      return ids;
    });
  }

  it("refuses more than 250 files to leave out, and writes nothing", async () => {
    const f = await setup();
    const ids = await sourceWithFiles(f, 251);
    const { projectId } = await newProject(f);
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          ...INPUTS_ONLY,
          excludeDocumentIds: ids,
        })
      )
    ).toBe("INVALID_INPUT");
    expect((await projectRows(f, projectId)).documents).toEqual([]);
  });

  it("counts a repeated id once", async () => {
    const f = await setup();
    const ids = await sourceWithFiles(f, 250);
    const { projectId } = await newProject(f);
    await f.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: f.sourceProjectId,
      toProjectId: projectId,
      ...INPUTS_ONLY,
      excludeDocumentIds: [...ids, ids[0], ids[1]],
    });
    const names = (await projectRows(f, projectId)).documents.map((row) => row.fileName);
    expect(names.some((name) => name.startsWith("Note "))).toBe(false);
  });
});

describe("last year's report edges (review D-5)", () => {
  it("is refused for a Review PD project", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.patch(f.sourceProjectId, { fiscalYearEnd: FYE_2024 }));
    const { projectId } = await f.writer.mutation(api.projects.createProject, {
      title: "Alloy furnace (copy)",
      clientName: "Forgeworks Inc.",
      mode: "review",
      fiscalYearEnd: FYE_2025,
      transcripts: [],
    });
    expect(
      await errorCode(() =>
        f.writer.action(api.projectDuplication.copyProjectContent, {
          fromProjectId: f.sourceProjectId,
          toProjectId: projectId,
          includeReport: false,
          includeReviews: true,
          previousYearReport: true,
        })
      )
    ).toBe("INVALID_INPUT");
    expect((await projectRows(f, projectId)).documents).toEqual([]);
  });

  it("is skipped when the original has no report", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.sourceProjectId, { fiscalYearEnd: FYE_2024 });
      for (const report of await ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", f.sourceProjectId))
        .collect()) {
        await ctx.db.delete(report._id);
      }
    });
    const { projectId, copied } = await duplicateLikeTheWizard(
      f,
      { ...INPUTS_ONLY, previousYearReport: true },
      { fiscalYearEnd: FYE_2025 }
    );
    expect(copied).toMatchObject({ previousYearReportCopied: false, documentsCopied: 2 });
    const rows = await projectRows(f, projectId);
    expect(rows.documents.filter((row) => row.category === "previous_pd")).toEqual([]);
  });
});

describe("transcript originals follow the copied row (review D-12, D-5)", () => {
  async function withOriginal(f: Fixture, bytes = "docx bytes") {
    return await f.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([bytes]));
      await ctx.db.patch(f.sourceTranscriptId, { originalStorageId: storageId });
      return storageId;
    });
  }

  it("gives pasted text with the same words no file", async () => {
    const f = await setup();
    await withOriginal(f);
    // The writer unticked the copied transcript and pasted the same text.
    const { projectId, transcriptIds } = await f.writer.mutation(api.projects.createProject, {
      title: "Alloy furnace (copy)",
      clientName: "Forgeworks Inc.",
      mode: "generate",
      transcripts: [{ content: SOURCE_TRANSCRIPT, label: "Pasted transcript 1" }],
    });
    const copied = await f.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: f.sourceProjectId,
      toProjectId: projectId,
      targetTranscriptId: transcriptIds[0],
      ...INPUTS_ONLY,
    });
    expect(copied).toMatchObject({ transcriptOriginalsCopied: 0 });
    const pasted = await f.t.run((ctx) => ctx.db.get(transcriptIds[0]));
    expect(pasted?.originalStorageId).toBeUndefined();
  });

  it("records which row a copied transcript came from", async () => {
    const f = await setup();
    const { transcriptIds } = await newProject(f);
    const copiedRow = await f.t.run((ctx) => ctx.db.get(transcriptIds[0]));
    expect(copiedRow?.copiedFromTranscriptId).toBe(f.sourceTranscriptId);
  });

  it("releases the clones it made when the copy fails part way", async () => {
    const f = await setup();
    // The transcript original can be stored once but not read again, so
    // the copy fails after it has already cloned the notes file.
    let reads = 0;
    class OneReadBlob extends Blob {
      override async arrayBuffer() {
        reads += 1;
        if (reads > 1) throw new Error("storage read failed");
        return await super.arrayBuffer();
      }
    }
    await f.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new OneReadBlob(["docx bytes"]));
      await ctx.db.patch(f.sourceTranscriptId, { originalStorageId: storageId });
    });
    const filesBefore = await storedFileIds(f);
    const { projectId, transcriptIds } = await newProject(f);
    await expect(
      f.writer.action(api.projectDuplication.copyProjectContent, {
        fromProjectId: f.sourceProjectId,
        toProjectId: projectId,
        targetTranscriptId: transcriptIds[0],
        ...INPUTS_ONLY,
      })
    ).rejects.toThrow("storage read failed");
    // The notes clone was made, then released: no new file is left behind.
    expect(await storedFileIds(f)).toEqual(filesBefore);
    const rows = await projectRows(f, projectId);
    const notes = rows.documents.find((row) => row.fileName === "Writer notes.md");
    expect(notes).toBeTruthy();
    expect(notes?.storageId).toBeUndefined();
  });

  it("releases a spare clone when the transcript already has a file", async () => {
    const f = await setup();
    const { projectId, transcriptIds } = await newProject(f);
    const { kept, spare } = await f.t.run(async (ctx) => {
      const kept = await ctx.storage.store(new Blob(["first"]));
      const spare = await ctx.storage.store(new Blob(["second"]));
      await ctx.db.patch(transcriptIds[0], { originalStorageId: kept });
      return { kept, spare };
    });
    await f.writer.mutation(internal.projects.finishProjectContentCopy, {
      toProjectId: projectId,
      storageCopies: [],
      transcriptCopies: [{ transcriptId: transcriptIds[0], storageId: spare }],
    });
    const row = await f.t.run((ctx) => ctx.db.get(transcriptIds[0]));
    expect(row?.originalStorageId).toBe(kept);
    expect(await storedFileIds(f)).not.toContain(spare);
  });
});
