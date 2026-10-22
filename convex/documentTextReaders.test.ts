/// <reference types="vite/client" />
/**
 * 2026-10-22 (fourth), step 2: every reader gives the same answer for a file
 * whose text moved to pieces (and whose `content` is cleared, as after the
 * backfill's clear pass) as for a file whose text is still on its row.
 * Every name and text here is fictional.
 */
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { ReadDocumentResult } from "./chatDocuments";
import { frozenSourceFields, selectFrozenEvidence } from "./lib/briefEvidence";
import { DOCUMENT_TEXT_PIECE_CHARS, writeDocumentText } from "./lib/documentText";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-text-readers";

const readDocument = makeFunctionReference("chatDocuments:readDocumentForChat") as unknown as FunctionReference<
  "query", "internal", { agentThreadId: string; documentId: Id<"projectDocuments">; start: number; maxChars: number },
  ReadDocumentResult
>;

/** Text with an emoji across a piece edge and across the 200,000 freeze cut. */
const LONG_TEXT = (() => {
  const chars = Array.from({ length: 230_000 }, (_, index) => (index % 61 === 60 ? "\n" : String.fromCharCode(97 + (index % 23))));
  for (const at of [DOCUMENT_TEXT_PIECE_CHARS - 1, 199_999]) {
    chars[at] = "\ud83d";
    chars[at + 1] = "\ude80";
  }
  return `Kestrel bench notes.\n${chars.join("")}`;
})();

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: writerAuthId, email: "writer@banhall.com", role: "writer" });
    const project = (title: string) =>
      ctx.db.insert("projects", {
        title, clientName: "Kestrel Instruments", status: "draft", createdBy: userId, ownerId: userId,
        shareToken: `${title}-token`, createdAt: now, updatedAt: now,
      });
    const movedProjectId = await project("Moved");
    const legacyProjectId = await project("Legacy");
    const reportId = await ctx.db.insert("reports", {
      projectId: movedProjectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1,
      generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", { projectId: movedProjectId, reportId, agentThreadId: "thread-moved", title: "Chat", createdAt: now });
    const row = (projectId: Id<"projects">, fileName: string, content: string) =>
      ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "txt", content, source: "upload", uploadedBy: "writer",
        uploaderRole: "writer", category: "other", processingStatus: "ready", processingDetail: "text_extracted",
        createdAt: now,
      });
    // Moved and cleared: the text lives only in pieces.
    const moved = async (projectId: Id<"projects">, fileName: string, text: string) => {
      const documentId = await row(projectId, fileName, "");
      const doc = await ctx.db.get(documentId);
      if (!doc) throw new Error("missing");
      await ctx.db.patch(documentId, await writeDocumentText(ctx, doc, text));
      return documentId;
    };
    return {
      userId,
      movedProjectId,
      legacyProjectId,
      movedLongId: await moved(movedProjectId, "bench-notes.txt", LONG_TEXT),
      movedShortId: await moved(movedProjectId, "summary.txt", "Short summary of the rig."),
      movedBlankId: await moved(movedProjectId, "blank.txt", "   \n "),
      legacyLongId: await row(legacyProjectId, "bench-notes.txt", LONG_TEXT),
      legacyShortId: await row(legacyProjectId, "summary.txt", "Short summary of the rig."),
    };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: writerAuthId }) };
}

describe("readers of a moved file (2026-10-22, fourth, step 2)", () => {
  test("the file list shows the same sizes and word counts", async () => {
    const f = await setup();
    const shape = (rows: Array<{ fileName: string; sizeChars: number; wordCount: number; processingStatus: string }>) =>
      rows.filter((row) => row.fileName !== "blank.txt")
        .map(({ fileName, sizeChars, wordCount, processingStatus }) => ({ fileName, sizeChars, wordCount, processingStatus }))
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
    const moved = await f.writer.query(api.documents.listDocuments, { projectId: f.movedProjectId });
    const legacy = await f.writer.query(api.documents.listDocuments, { projectId: f.legacyProjectId });
    expect(shape(moved)).toEqual(shape(legacy));
    expect(moved.find((row) => row.fileName === "bench-notes.txt")?.sizeChars).toBe(LONG_TEXT.length);
  });

  test("the Files panel preview gets the whole text", async () => {
    const f = await setup();
    const preview = await f.writer.query(api.documents.getDocumentContent, { documentId: f.movedLongId });
    expect(preview?.content).toBe(LONG_TEXT);
  });

  test("chat's file reading tool returns the same ranges, never splitting a character", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      // The legacy twin, in the thread's project, to compare against.
      const legacy = await ctx.db.get(f.legacyLongId);
      if (legacy) await ctx.db.patch(f.legacyLongId, { projectId: f.movedProjectId, fileName: "twin.txt" });
    });
    for (const [start, maxChars] of [
      [0, 100],
      [DOCUMENT_TEXT_PIECE_CHARS - 50, 49],
      [DOCUMENT_TEXT_PIECE_CHARS - 50, 50],
      [DOCUMENT_TEXT_PIECE_CHARS, 10],
      [199_990, 30],
      [LONG_TEXT.length - 5, 100],
    ] as const) {
      const read = (documentId: Id<"projectDocuments">) =>
        f.t.query(readDocument, { agentThreadId: "thread-moved", documentId, start, maxChars });
      const moved = await read(f.movedLongId);
      const legacy = await read(f.legacyLongId);
      expect(moved.status).toBe("ok");
      expect({ ...moved, fileName: "" }, `${start}+${maxChars}`).toEqual({ ...legacy, fileName: "" });
    }
    expect(await f.t.query(readDocument, { agentThreadId: "thread-moved", documentId: f.movedBlankId, start: 0, maxChars: 10 }))
      .toEqual({ status: "no_text", fileName: "blank.txt" });
  });

  test("the evidence frozen at generation start is byte for byte the same", async () => {
    const f = await setup();
    const frozen = (projectId: Id<"projects">) =>
      f.t.run(async (ctx) => {
        const fields = await frozenSourceFields(await selectFrozenEvidence(ctx, projectId));
        return fields
          .map(({ label, content, contentHash, truncated, originalLength, uploaderRole }) =>
            ({ label, content, contentHash, truncated, originalLength, uploaderRole }))
          .sort((a, b) => a.label.localeCompare(b.label));
      });
    const moved = await frozen(f.movedProjectId);
    const legacy = await frozen(f.legacyProjectId);
    // The blank moved file is skipped, as a blank legacy file would be.
    expect(moved).toEqual(legacy);
    const long = moved.find((row) => row.label.endsWith("bench-notes.txt"));
    expect(long?.content).toBe(LONG_TEXT.slice(0, 200_000));
    expect(long).toMatchObject({ truncated: true, originalLength: LONG_TEXT.length });
  });

  test("an upload finds a moved duplicate by fingerprint, and keeps other files apart", async () => {
    const f = await setup();
    const count = () =>
      f.t.run(async (ctx) =>
        (await ctx.db.query("projectDocuments")
          .withIndex("by_projectId", (q) => q.eq("projectId", f.movedProjectId))
          .take(20)).length);
    const before = await count();
    const upload = (fileName: string, content: string) =>
      f.writer.mutation(api.documents.uploadDocument, { projectId: f.movedProjectId, fileName, fileType: "txt", content });
    expect(await upload("bench-notes.txt", LONG_TEXT)).toBe(f.movedLongId);
    expect(await upload("summary.txt", "Short summary of the rig.")).toBe(f.movedShortId);
    expect(await count()).toBe(before);
    // The same text under another name, other text under the same name, and
    // a blank file are new files, as before.
    expect(await upload("renamed.txt", "Short summary of the rig.")).not.toBe(f.movedShortId);
    expect(await upload("summary.txt", "Another summary.")).not.toBe(f.movedShortId);
    expect(await upload("blank.txt", "   \n ")).not.toBe(f.movedBlankId);
    expect(await count()).toBe(before + 3);
  });
});
