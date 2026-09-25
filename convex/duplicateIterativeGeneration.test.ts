/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

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
    return { userId, sourceProjectId, sourceTranscriptId, notesStorageId };
  });
  return { t, writer: t.withIdentity({ subject: authId }), ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/**
 * The wizard's duplicate commit, minus the browser. `scope` is what the
 * card Duplicate passes; the plain `?from=` link passes nothing.
 */
async function duplicateLikeTheWizard(
  f: Fixture,
  scope: { includeReport?: boolean; includeReviews?: boolean } = {}
) {
  const { projectId, transcriptIds } = await f.writer.mutation(api.projects.createProject, {
    title: "Alloy furnace (copy)",
    clientName: "Forgeworks Inc.",
    mode: "generate",
    transcripts: [{ fromTranscriptId: f.sourceTranscriptId, label: "Kickoff interview.docx" }],
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
