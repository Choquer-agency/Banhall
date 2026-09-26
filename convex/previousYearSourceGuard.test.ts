/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { buildTiptapDocument } from "./lib/tiptapReport";
import {
  PREVIOUS_YEAR_ONLY_MESSAGE,
  PREVIOUS_YEAR_ONLY_REASON,
  PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE,
  previousYearReportHeader,
} from "../shared/previousYear";

/**
 * Decision 42 (2026-09-25): a draft is never built from last year's report
 * alone. With no transcript, at least one readable file outside the
 * Previous-year reports category is needed; the original's report brought
 * along by a duplicate is such a file too. The check sits in
 * reserveGeneration, so every way a generation is reserved (requestGeneration
 * in each Drafts mode, retryGeneration, retryFailedCandidates) refuses before
 * anything is scheduled. The Jul-17 files-only rule is otherwise unchanged,
 * and a Review PD project never drafts, so its review is unaffected.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "previous-year-guard-writer";
const FYE_2024 = Date.UTC(2024, 11, 31);
const FYE_2025 = Date.UTC(2025, 11, 31);
const INPUTS_ONLY = { includeReport: false, includeReviews: false } as const;
const LAST_YEAR = `${previousYearReportHeader(2024)}\nLast year we built the furnace controller.`;

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  // Hold scheduled functions: a reserved generation schedules its start,
  // and nothing here may run a paid call. See duplicateIterativeGeneration.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const data = (error as { data?: { code?: string; reason?: string; message?: string } }).data;
    return data ?? { code: String(error) };
  }
  return { code: "no error" };
}

const PREVIOUS_YEAR_ONLY = {
  code: "INVALID_INPUT",
  reason: PREVIOUS_YEAR_ONLY_REASON,
  message: PREVIOUS_YEAR_ONLY_MESSAGE,
};

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { authId, role: "writer" }));
  return { t, userId, writer: t.withIdentity({ subject: authId }) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

type Doc = {
  fileName: string;
  category?: "previous_pd" | "scoping_notes" | "writer_notes" | "background" | "other";
  content: string;
  archived?: boolean;
  source?: string;
};

async function addDocuments(f: Fixture, projectId: Id<"projects">, docs: Doc[]) {
  return await f.t.run(async (ctx) => {
    const ids: Id<"projectDocuments">[] = [];
    for (const doc of docs) {
      ids.push(
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: doc.fileName,
          fileType: "txt",
          content: doc.content,
          ...(doc.category ? { category: doc.category } : {}),
          ...(doc.archived ? { archived: true } : {}),
          source: doc.source ?? "context_input",
          uploadedBy: "Writer",
          uploaderRole: "writer",
          createdAt: Date.now(),
        })
      );
    }
    return ids;
  });
}

/** A fresh New project, as the wizard creates it before uploading files. */
async function freshProject(f: Fixture, transcripts: string[] = [], docs: Doc[] = []) {
  const { projectId } = await f.writer.mutation(api.projects.createProject, {
    title: "Furnace controller",
    clientName: "Forgeworks Inc.",
    mode: "generate",
    transcripts: transcripts.map((content, index) => ({ content, label: `Interview ${index + 1}` })),
  });
  await addDocuments(f, projectId, docs);
  return projectId;
}

async function state(f: Fixture, projectId: Id<"projects">) {
  return await f.t.run(async (ctx) => ({
    project: await ctx.db.get(projectId),
    generations: await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect(),
    scheduled: (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
      /generateReport|startIterativeGeneration/.test(job.name)
    ),
  }));
}

async function expectNothingReserved(f: Fixture, projectId: Id<"projects">) {
  const after = await state(f, projectId);
  expect(after.generations).toEqual([]);
  expect(after.scheduled).toEqual([]);
  expect(after.project?.activeGenerationId).toBeUndefined();
  expect(after.project?.status).toBe("draft");
}

describe("a fresh New project (decision 42)", () => {
  it.each(["compare", "single", "iterative"] as const)(
    "refuses a draft in %s mode whose only file is a previous-year report",
    async (candidateMode) => {
      const f = await setup();
      const projectId = await freshProject(f, [], [
        { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
      ]);
      expect(
        await refusal(() =>
          f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode })
        )
      ).toMatchObject(PREVIOUS_YEAR_ONLY);
      await expectNothingReserved(f, projectId);
    }
  );

  it("refuses when the only current files are archived or empty", async () => {
    const f = await setup();
    const projectId = await freshProject(f, [], [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
      { fileName: "FY2023 PD.docx", category: "previous_pd", content: "Two years ago." },
      { fileName: "Old notes.md", category: "writer_notes", content: "Old notes.", archived: true },
      { fileName: "Scan.pdf", category: "other", content: "   " },
    ]);
    expect(
      await refusal(() =>
        f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" })
      )
    ).toMatchObject(PREVIOUS_YEAR_ONLY);
    await expectNothingReserved(f, projectId);
  });

  it("keeps the Jul-17 message when there is no readable file at all", async () => {
    const f = await setup();
    const projectId = await freshProject(f);
    const refused = await refusal(() =>
      f.writer.mutation(api.generations.requestGeneration, { projectId })
    );
    expect(refused).toMatchObject({ code: "INVALID_INPUT" });
    expect(refused).not.toHaveProperty("reason");
  });

  it.each<[string, Doc]>([
    ["writer's notes", { fileName: "Notes.md", category: "writer_notes", content: "This year's tests." }],
    ["a chat upload with no category", { fileName: "Chat.pdf", content: "Test log.", source: "chat_upload" }],
  ])("drafts from a previous-year report and %s", async (_label, current) => {
    const f = await setup();
    const projectId = await freshProject(f, [], [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
      current,
    ]);
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "iterative",
    });
    const sources = await f.t.run((ctx) =>
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
        .collect()
    );
    expect(sources.map((source) => source.label).sort()).toEqual(
      [`${current.category ?? "other"}:${current.fileName}`, "previous_pd:FY2024 PD.docx"].sort()
    );
  });

  it("drafts from previous-year files and a transcript", async () => {
    const f = await setup();
    const projectId = await freshProject(
      f,
      ["Interviewer: What was uncertain?\nEngineer: How the controller would hold temperature."],
      [
        { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
        { fileName: "FY2023 PD.docx", category: "previous_pd", content: "Two years ago." },
      ]
    );
    const generationId = await f.writer.mutation(api.generations.requestGeneration, {
      projectId,
      candidateMode: "compare",
    });
    expect((await state(f, projectId)).generations.map((row) => row._id)).toEqual([generationId]);
  });
});

describe("a card duplicate (decision 42)", () => {
  const REPORT = JSON.stringify(
    buildTiptapDocument(
      "Alloy furnace",
      "Whether the alloy would crack under repeated heating.",
      "We ran heating cycles on test bars.",
      "We learned the crack threshold."
    )
  );

  async function source(f: Fixture) {
    return await f.t.run(async (ctx) => {
      const now = Date.now();
      const sourceProjectId = await ctx.db.insert("projects", {
        title: "Alloy furnace",
        clientName: "Forgeworks Inc.",
        status: "review",
        mode: "generate",
        createdBy: f.userId,
        ownerId: f.userId,
        workflowStage: "drafting",
        shareToken: "previous-year-guard-token",
        fiscalYearEnd: FYE_2024,
        createdAt: now,
        updatedAt: now,
      });
      const sourceTranscriptId = await ctx.db.insert("transcripts", {
        projectId: sourceProjectId,
        label: "Kickoff interview.docx",
        position: 0,
        content: "Interviewer: What could you not predict?\nEngineer: How the alloy would crack.",
        createdAt: now,
      });
      const notesId = await ctx.db.insert("projectDocuments", {
        projectId: sourceProjectId,
        fileName: "Writer notes.md",
        fileType: "md",
        content: "Writer's notes: the cracking tests are the real uncertainty.",
        category: "writer_notes",
        source: "context_input",
        uploadedBy: "Writer",
        uploaderRole: "writer",
        createdAt: now,
      });
      await ctx.db.insert("projectDocuments", {
        projectId: sourceProjectId,
        fileName: "FY2023 PD.docx",
        fileType: "docx",
        content: "The year before last.",
        category: "previous_pd",
        source: "context_input",
        uploadedBy: "Writer",
        uploaderRole: "writer",
        createdAt: now,
      });
      await ctx.db.insert("reports", {
        projectId: sourceProjectId,
        content: REPORT,
        version: 3,
        generatedAt: now,
        updatedAt: now,
        sourceTranscriptId,
      });
      return { sourceProjectId, sourceTranscriptId, notesId };
    });
  }

  /** The wizard's card duplicate commit, a year on, minus the browser. */
  async function duplicate(
    f: Fixture,
    options: {
      keepTranscript: boolean;
      leaveNotes: boolean;
      newTranscript?: boolean;
      sameYear?: boolean;
    }
  ) {
    const from = await source(f);
    const { projectId, transcriptIds } = await f.writer.mutation(api.projects.createProject, {
      title: "Alloy furnace (copy)",
      clientName: "Forgeworks Inc.",
      mode: "generate",
      fiscalYearEnd: options.sameYear ? FYE_2024 : FYE_2025,
      transcripts: [
        ...(options.keepTranscript
          ? [{ fromTranscriptId: from.sourceTranscriptId, label: "Kickoff interview.docx" }]
          : []),
        ...(options.newTranscript
          ? [{ content: "Interviewer: What changed this year?\nEngineer: The new alloy.", label: "This year" }]
          : []),
      ],
    });
    await f.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: from.sourceProjectId,
      toProjectId: projectId,
      ...(transcriptIds[0] ? { targetTranscriptId: transcriptIds[0] } : {}),
      ...INPUTS_ONLY,
      ...(options.leaveNotes ? { excludeDocumentIds: [from.notesId] } : {}),
      previousYearReport: !options.sameYear,
    });
    return projectId;
  }

  it("refuses a draft from last year's report and previous-year files alone", async () => {
    const f = await setup();
    const projectId = await duplicate(f, { keepTranscript: false, leaveNotes: true });
    const documents = await f.t.run((ctx) =>
      ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(documents.map((document) => document.category)).toEqual(["previous_pd", "previous_pd"]);
    expect(
      await refusal(() =>
        f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" })
      )
    ).toMatchObject(PREVIOUS_YEAR_ONLY);
    await expectNothingReserved(f, projectId);
  });

  it("drafts when a current file comes along", async () => {
    const f = await setup();
    const projectId = await duplicate(f, { keepTranscript: false, leaveNotes: false });
    await f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" });
    expect((await state(f, projectId)).generations).toHaveLength(1);
  });

  // Lead note of 2026-09-25 (audit a4 #12): a year on, the transcripts
  // copied from the original are last year's too.
  it("refuses last year's copied transcript with last year's report", async () => {
    const f = await setup();
    const projectId = await duplicate(f, { keepTranscript: true, leaveNotes: true });
    for (const candidateMode of ["compare", "single", "iterative"] as const) {
      expect(
        await refusal(() =>
          f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode })
        )
      ).toMatchObject({ ...PREVIOUS_YEAR_ONLY, message: PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE });
    }
    await expectNothingReserved(f, projectId);
  });

  it("drafts when a new transcript comes along with last year's copied one", async () => {
    const f = await setup();
    const projectId = await duplicate(f, { keepTranscript: true, leaveNotes: true, newTranscript: true });
    await f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" });
    expect((await state(f, projectId)).generations).toHaveLength(1);
  });

  it("drafts when a current file comes along with last year's copied transcript", async () => {
    const f = await setup();
    const projectId = await duplicate(f, { keepTranscript: true, leaveNotes: false });
    await f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" });
    expect((await state(f, projectId)).generations).toHaveLength(1);
  });

  it("counts a copied transcript as current on a same-year duplicate", async () => {
    const f = await setup();
    const projectId = await duplicate(f, { keepTranscript: true, leaveNotes: true, sameYear: true });
    await f.writer.mutation(api.generations.requestGeneration, { projectId, candidateMode: "iterative" });
    expect((await state(f, projectId)).generations).toHaveLength(1);
  });
});

describe("every reservation checks it (decision 42)", () => {
  it("refuses retrying a failed draft once only previous-year files are left", async () => {
    const f = await setup();
    const projectId = await freshProject(f, [], [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
    ]);
    const [notesId] = await addDocuments(f, projectId, [
      { fileName: "Notes.md", category: "writer_notes", content: "This year's tests." },
    ]);
    const generationId = await f.writer.mutation(api.generations.requestGeneration, { projectId });
    await f.t.run(async (ctx) => {
      await ctx.db.patch(generationId, { status: "failed" });
      await ctx.db.patch(projectId, { activeGenerationId: undefined, status: "draft" });
      await ctx.db.patch(notesId, { archived: true });
    });
    expect(
      await refusal(() => f.writer.mutation(api.generations.retryGeneration, { generationId }))
    ).toMatchObject(PREVIOUS_YEAR_ONLY);
    expect((await state(f, projectId)).generations).toHaveLength(1);
  });

  it("refuses retrying failed comparison drafts and keeps the partial generation", async () => {
    const f = await setup();
    const projectId = await freshProject(f, [], [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
    ]);
    const partialId = await f.t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", {
        projectId,
        status: "awaiting_selection",
        requestedBy: f.userId,
        candidateMode: "compare",
        compareModelIds: ["claude-sonnet-5", "google/gemini-3.1-pro-preview"],
        previousProjectStatus: "draft",
        candidatesDone: 0,
        candidatesFailed: 1,
        startedAt: now,
      });
      await ctx.db.patch(projectId, { activeGenerationId: generationId, status: "generating" });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "failed",
        queuedAt: now,
        completedAt: now,
      });
      return generationId;
    });
    expect(
      await refusal(() =>
        f.writer.mutation(api.generations.retryFailedCandidates, { generationId: partialId })
      )
    ).toMatchObject(PREVIOUS_YEAR_ONLY);
    const after = await state(f, projectId);
    expect(after.generations.map((row) => [row._id, row.status])).toEqual([
      [partialId, "awaiting_selection"],
    ]);
    expect(after.project?.activeGenerationId).toBe(partialId);
  });
});

describe("Review PD is unaffected (decision 42)", () => {
  it("starts a PD review with only a previous-year file beside the written PD", async () => {
    const f = await setup();
    const { projectId } = await f.writer.mutation(api.projects.createProject, {
      title: "Furnace controller",
      clientName: "Forgeworks Inc.",
      mode: "review",
      transcripts: [],
    });
    const [, pdId] = await addDocuments(f, projectId, [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
      { fileName: "Written PD.docx", content: "This year's written PD.", source: "review_pd" },
    ]);
    await f.writer.mutation(api.pdReviews.startPdReview, { projectId, documentId: pdId });
    const reviews = await f.t.run((ctx) =>
      ctx.db
        .query("pdReviews")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(reviews.map((review) => review.status)).toEqual(["running"]);
  });
});

describe("the rule runs on what the writer left in (decision 56)", () => {
  it("refuses when unticking the only current file leaves last year's report", async () => {
    const f = await setup();
    const projectId = await freshProject(f, [], [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
      { fileName: "Notes.md", category: "writer_notes", content: "This year's tests." },
    ]);
    const notes = await f.t.run(async (ctx) =>
      (
        await ctx.db
          .query("projectDocuments")
          .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
          .collect()
      ).find((row) => row.fileName === "Notes.md")!._id
    );
    expect(
      await refusal(() =>
        f.writer.mutation(api.generations.requestGeneration, {
          projectId,
          candidateMode: "iterative",
          excludeDocumentIds: [notes],
        })
      )
    ).toMatchObject(PREVIOUS_YEAR_ONLY);
    await expectNothingReserved(f, projectId);
  });

  it("refuses when unticking the only transcript leaves last year's report", async () => {
    const f = await setup();
    const projectId = await freshProject(f, ["Interviewer: What was uncertain?\nEngineer: Heat."], [
      { fileName: "FY2024 PD.docx", category: "previous_pd", content: LAST_YEAR },
    ]);
    const transcriptIds = await f.t.run(async (ctx) =>
      (
        await ctx.db
          .query("transcripts")
          .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
          .collect()
      ).map((row) => row._id)
    );
    expect(
      await refusal(() =>
        f.writer.mutation(api.generations.requestGeneration, {
          projectId,
          candidateMode: "single",
          excludeTranscriptIds: transcriptIds,
        })
      )
    ).toMatchObject(PREVIOUS_YEAR_ONLY);
    await expectNothingReserved(f, projectId);
  });
});
