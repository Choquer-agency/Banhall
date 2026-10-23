/// <reference types="vite/client" />
/**
 * 2026-10-22 (fourth): a project with 50 files of 400,000 characters each
 * (about 20 MB of text) keeps its file list and its uploads within Convex's
 * per-function read limit. Before the change each of these paths read every
 * file's whole text and was refused past 16 MiB.
 */
import { convexTest } from "convex-test";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import schema from "./schema";
import { writeDocumentText } from "./lib/documentText";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-document-scale";
const FILES = 50;
const FILE_CHARS = 400_000;
/** Reads a metadata path may spend: far below the 16 MiB function limit. */
const METADATA_READ_BUDGET = 1024 * 1024;

type TestCtx = GenericMutationCtx<DataModel> & {
  meta: { getTransactionMetrics(): Promise<{ bytesRead: { used: number } }> };
};

const fileText = (index: number) => {
  const head = `File ${index}. `;
  return `${head}${"x".repeat(FILE_CHARS - head.length)}`;
};

async function largeProject() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const now = Date.now();
  const projectId = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: writerAuthId,
      email: "writer@banhall.com",
      role: "writer",
    });
    return await ctx.db.insert("projects", {
      title: "Large project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "large-project-token",
      createdAt: now,
      updatedAt: now,
    });
  });
  const writer = t.withIdentity({ subject: writerAuthId });
  // Uploaded through the app, one file per upload, as a writer would.
  for (let index = 0; index < FILES; index += 1) {
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: `evidence-${index}.txt`,
      fileType: "txt",
      content: fileText(index),
    });
  }
  return { t, projectId, writer };
}

/** Runs `body` as the writer and returns what it read. */
async function measured<T>(
  writer: { mutation: (handler: (ctx: TestCtx) => Promise<{ value: T; bytesRead: number }>) => Promise<{ value: T; bytesRead: number }> },
  body: (ctx: TestCtx) => Promise<T>
) {
  const withMetrics = async (ctx: TestCtx) => {
    const value = await body(ctx);
    const metrics = await ctx.meta.getTransactionMetrics();
    return { value, bytesRead: metrics.bytesRead.used };
  };
  return await writer.mutation(withMetrics);
}

describe("50 files of 400,000 characters (2026-10-22, fourth)", () => {
  test("a chat turn's context reads facts and only the shown files' opening text", { timeout: 180_000 }, async () => {
    const { t, projectId, writer } = await largeProject();
    const reportId = await t.run(async (ctx) => {
      const now = Date.now();
      const reportId = await ctx.db.insert("reports", {
        projectId: projectId as Id<"projects">, content: JSON.stringify({ type: "doc", content: [] }), version: 1,
        generatedAt: now, updatedAt: now, revisionNumber: 0,
      });
      await ctx.db.insert("agentChatThreads", {
        projectId: projectId as Id<"projects">, reportId, agentThreadId: "thread-large", title: "Chat", createdAt: now,
      });
      return reportId;
    });
    const { value, bytesRead } = await measured(writer as never, (ctx) =>
      ctx.runQuery(internal.chatV2.getChatContextV2, { reportId, agentThreadId: "thread-large" }));
    expect(value.documents).toHaveLength(FILES);
    expect(value.documents.every((doc) => doc.textLength === FILE_CHARS)).toBe(true);
    // 12 shown files to just past 20,000 characters, previews for the rest.
    expect(bytesRead).toBeLessThan(2 * 1024 * 1024);
  });

  test("a 400,000-character file in a 3-byte script is stored and read back", { timeout: 60_000 }, async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const projectId = await t.run(async (ctx) => {
      const writerId = await ctx.db.insert("users", { authId: writerAuthId, email: "writer@banhall.com", role: "writer" });
      const now = Date.now();
      return await ctx.db.insert("projects", {
        title: "Wide script", clientName: "Client", status: "draft", createdBy: writerId, ownerId: writerId,
        shareToken: "wide-script-token", createdAt: now, updatedAt: now,
      });
    });
    const writer = t.withIdentity({ subject: writerAuthId });
    // About 1.2 MB of UTF-8, more than one row may hold.
    const text = "語".repeat(FILE_CHARS);
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId, fileName: "wide.txt", fileType: "txt", content: text,
    });
    const preview = await writer.query(api.documents.getDocumentContent, { documentId });
    expect(preview?.content).toBe(text);
  });

  test("the file list reads facts, not text", { timeout: 180_000 }, async () => {
    const { projectId, writer } = await largeProject();
    const { value, bytesRead } = await measured(writer as never, (ctx) =>
      ctx.runQuery(api.documents.listDocuments, { projectId }));
    expect(value).toHaveLength(FILES);
    expect(value.every((doc) => doc.sizeChars === FILE_CHARS)).toBe(true);
    expect(bytesRead).toBeLessThan(METADATA_READ_BUDGET);
  });

  test("a new upload and a duplicate upload read facts, not every file's text", { timeout: 180_000 }, async () => {
    const { t, projectId, writer } = await largeProject();
    const fresh = await measured(writer as never, (ctx) =>
      ctx.runMutation(api.documents.uploadDocument, {
        projectId,
        fileName: "new.txt",
        fileType: "txt",
        content: "A new file.",
      }));
    expect(fresh.bytesRead).toBeLessThan(METADATA_READ_BUDGET);
    const duplicate = await measured(writer as never, (ctx) =>
      ctx.runMutation(api.documents.uploadDocument, {
        projectId,
        fileName: "evidence-7.txt",
        fileType: "txt",
        content: fileText(7),
      }));
    // The duplicate is found and nothing new is stored. It may read the one
    // matching file's text to confirm the match, never every file's.
    const rows = await t.run(async (ctx) =>
      await ctx.db.query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId as Id<"projects">))
        .take(FILES + 5));
    expect(rows).toHaveLength(FILES + 1);
    expect(duplicate.bytesRead).toBeLessThan(METADATA_READ_BUDGET + FILE_CHARS * 2);
  });
});

describe("research reads within the limit (2026-10-22, fourth, review fix)", () => {
  test("eight 900,000-character files in a 3-byte script do not pass the read limit", { timeout: 180_000 }, async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { sessionId } = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { authId: "auth-research-scale", email: "w@banhall.com", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "Research scale", clientName: "Client", status: "draft", createdBy: userId, ownerId: userId,
        shareToken: "research-scale-token", createdAt: now, updatedAt: now,
      });
      const reportId = await ctx.db.insert("reports", {
        projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
      });
      const sessionId = await ctx.db.insert("researchSessions", {
        projectId, reportId, requestedBy: userId, selectedText: "", selectionFrom: 0, selectionTo: 0,
        surroundingContext: "", instruction: "", externalBrief: "", reportRevisionNumber: 0,
        status: "researching", createdAt: now, updatedAt: now,
      });
      return { sessionId, projectId };
    }).then(async (ids) => {
      // About 2.7 MB of text each, written one file per transaction.
      for (let index = 0; index < 8; index += 1) {
        await t.run(async (ctx) => {
          const documentId = await ctx.db.insert("projectDocuments", {
            projectId: ids.projectId, fileName: `wide-${index}.txt`, fileType: "txt", source: "upload",
            uploadedBy: "writer", createdAt: Date.now(),
          });
          await ctx.db.patch(documentId, await writeDocumentText(ctx, { _id: documentId, projectId: ids.projectId }, "語".repeat(900_000)));
        });
      }
      return ids;
    });
    await expect(t.mutation(internal.research.collectProjectEvidence, { sessionId })).resolves.toBeNull();
  });
});
