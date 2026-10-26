/// <reference types="vite/client" />
/**
 * 2026-10-26 (owner): a Word file is stored as Markdown and shown formatted,
 * and a draft freezes it without its bold and italic marks, so the AI's
 * quotes are found and checked exactly as before.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { FROZEN_DOCUMENT_CHARS, frozenSourceFields, selectFrozenEvidence } from "./lib/briefEvidence";
import { selectDraftEvidence } from "./lib/intakeDrafts";
import { intakeDraftRefs } from "./lib/intakeDraftRefs";
import { citeQuote, validateCitation } from "./lib/citations";
import { RICH_WORD_MARKDOWN } from "./ai/testFiles.fixture";
import { quotableWordText } from "../shared/wordMarkdown";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-word-markdown-tests";

async function setup() {
  const t = convexTest(schema, modules);
  const { projectId } = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: writerAuthId, email: "writer@banhall.com", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Seal trials",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "word-markdown-token",
      createdAt: now,
      updatedAt: now,
    });
    return { projectId };
  });
  return { t, projectId, writer: t.withIdentity({ subject: writerAuthId }) };
}

/** The frozen rows as a draft holds them, with ids citations can carry. */
function asSources(fields: Awaited<ReturnType<typeof frozenSourceFields>>) {
  return fields.map((field, index) => ({ ...field, _id: `source-${index}` }));
}

describe("a Word file stored as Markdown", () => {
  test("keeps its Markdown and flag, and the preview gets both", async () => {
    const { projectId, writer } = await setup();
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.docx",
      fileType: "docx",
      content: RICH_WORD_MARKDOWN,
      textFormat: "markdown",
    });
    expect(await writer.query(api.documents.getDocumentContent, { documentId })).toMatchObject({
      content: RICH_WORD_MARKDOWN,
      textFormat: "markdown",
    });
  });

  test("is frozen without its marks, so a quote given without them is found and checks", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.docx",
      fileType: "docx",
      content: RICH_WORD_MARKDOWN,
      textFormat: "markdown",
    });
    // A plain file with a literal asterisk is frozen as it is.
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.txt",
      fileType: "txt",
      content: "Rig *B* ran 5 * 3 cycles.",
    });
    const fields = await t.run(async (ctx) => frozenSourceFields(await selectFrozenEvidence(ctx, projectId)));
    const word = fields.find((field) => field.label.endsWith("trials.docx"))!;
    const notes = fields.find((field) => field.label.endsWith("notes.txt"))!;
    expect(word.content).toBe(quotableWordText(RICH_WORD_MARKDOWN));
    expect(word.content).toContain("# Seal trials");
    expect(word.content).toContain("The seal held at 4.2 bar in trial 3, and 5 * 3 = 15.");
    expect(word.content).toContain("| 2 | 4.2 bar |");
    expect(word.truncated).toBe(false);
    expect(notes.content).toBe("Rig *B* ran 5 * 3 cycles.");

    const sources = asSources(fields);
    const citation = citeQuote(sources, "The seal held at 4.2 bar in trial 3");
    expect(citation).not.toBeNull();
    expect(validateCitation(sources.find((source) => source._id === citation!.sourceId), citation!)).toBe(true);
  });

  test("is marked truncated by its stored length, not by the shorter frozen view", async () => {
    const { t, projectId, writer } = await setup();
    const long = `**Bold** ${"word ".repeat(Math.ceil(FROZEN_DOCUMENT_CHARS / 5))}`.trim();
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "long.docx",
      fileType: "docx",
      content: long,
      textFormat: "markdown",
    });
    const short = "**Short** report.";
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "short.docx",
      fileType: "docx",
      content: short,
      textFormat: "markdown",
    });
    const fields = await t.run(async (ctx) => frozenSourceFields(await selectFrozenEvidence(ctx, projectId)));
    expect(fields.find((field) => field.label.endsWith("long.docx"))!.truncated).toBe(true);
    const shortField = fields.find((field) => field.label.endsWith("short.docx"))!;
    expect(shortField).toMatchObject({ content: "Short report.", truncated: false });
  });

  test("in an intake draft, is frozen the same way and keeps its flag when the project is made", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      rateLimiterTest.register(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("users", { authId: "word-intake-writer", role: "writer", name: "Wren Writer" });
      });
      const writer = t.withIdentity({ subject: "word-intake-writer" });
      const draftId = await writer.mutation(intakeDraftRefs.createIntakeDraft, {});
      await writer.mutation(intakeDraftRefs.saveIntakeSource, {
        draftId,
        sourceKey: "transcript-key-1",
        kind: "transcript",
        position: 0,
        label: "Interview",
        content: "Interviewer: Did the seal hold?\n\nPriya Raman: It held at 4.2 bar in trial 3.",
        sourceFormat: "txt",
      });
      await writer.mutation(intakeDraftRefs.saveIntakeSource, {
        draftId,
        sourceKey: "document-key-1",
        kind: "document",
        position: 1000,
        label: "trials.docx",
        content: RICH_WORD_MARKDOWN,
        fileType: "docx",
        category: "background",
        intake: "file",
        extractionOutcome: "ok",
        textFormat: "markdown",
      });
      const evidence = await t.run(async (ctx) => selectDraftEvidence(ctx, (await ctx.db.get(draftId))!));
      const word = evidence.fields.find((field) => field.label.endsWith("trials.docx"))!;
      expect(word.content).toBe(quotableWordText(RICH_WORD_MARKDOWN));
      expect(word.truncated).toBe(false);

      const receipt = await writer.mutation(intakeDraftRefs.promoteIntakeDraft, {
        draftId,
        commandId: "command-1",
        sourceKeys: ["transcript-key-1", "document-key-1"],
        project: { title: "Seal trials", clientName: "Acme Seals", interviewees: ["Priya Raman"] },
      });
      if ("ended" in receipt) throw new Error("The draft ended");
      const promoted = async () =>
        await t.run(async (ctx) =>
          (await ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).first()) !== null
        );
      for (let step = 0; step < 20 && !(await promoted()); step += 1) {
        vi.advanceTimersByTime(600);
        await t.finishInProgressScheduledFunctions();
      }
      const documents = await t.run(async (ctx) =>
        ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", receipt.projectId)).collect()
      );
      expect(documents).toEqual([expect.objectContaining({ fileName: "trials.docx", textFormat: "markdown" })]);
    } finally {
      vi.useRealTimers();
    }
  });
});

