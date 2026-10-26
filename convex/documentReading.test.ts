/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase B2): the server reads a project file's stored original
 * when the browser got no text or stopped early, and keeps the reading only
 * when it is fuller and every position into the old text still holds.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { pdfPageStopMarker } from "../shared/documentStatus";
import { documentTextHash, readDocumentText } from "./lib/documentText";
import { needsServerReading, serverReadingReplaces, stoppedEarly } from "./lib/serverReading";
import { readFileOnServer, SERVER_READER_VERSION } from "./ai/fileReader";
import { textPdf } from "./ai/testFiles.fixture";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-document-reading-tests";

const PAGES = ["Trial one held at 4.2 bar.", "Trial two failed at 3.1 bar.", "Trial three held at 5.0 bar."];

beforeEach(() => {
  // Scheduled readings run only when a test runs them.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const projectId = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: writerAuthId, email: "writer@banhall.com", role: "writer" });
    return await ctx.db.insert("projects", {
      title: "Seal trials",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "document-reading-token",
      createdAt: now,
      updatedAt: now,
    });
  });
  return { t, projectId, writer: t.withIdentity({ subject: writerAuthId }) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function store(t: Setup["t"], bytes: Uint8Array): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => await ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" })));
}

async function scheduledReadings(t: Setup["t"]) {
  const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
  return jobs.filter((job) => job.name.includes("fileReading"));
}

async function fileState(t: Setup["t"], documentId: Id<"projectDocuments">) {
  return await t.run(async (ctx) => {
    const doc = (await ctx.db.get(documentId))!;
    return { doc, text: await readDocumentText(ctx, doc) };
  });
}

/** The text the browser keeps when it stops before `page` (1-based). */
async function browserStoppedAt(page: number): Promise<string> {
  const whole = await readFileOnServer(textPdf(PAGES), "trials.pdf");
  return `${whole.text.slice(0, whole.pageOffsets![page - 1]!)}${pdfPageStopMarker(page)}`.trim();
}

describe("when the server reads a file again", () => {
  test("only a supported, stored, unread file with no text or a stopped reading", () => {
    const storageId = "storage" as Id<"_storage">;
    const base = { fileName: "trials.pdf", storageId, hasText: false, stoppedEarly: false };
    expect(needsServerReading(base)).toBe(true);
    expect(needsServerReading({ ...base, hasText: true })).toBe(false);
    expect(needsServerReading({ ...base, hasText: true, stoppedEarly: true })).toBe(true);
    expect(needsServerReading({ ...base, storageId: undefined })).toBe(false);
    expect(needsServerReading({ ...base, archived: true })).toBe(false);
    expect(needsServerReading({ ...base, serverReadAt: 1 })).toBe(false);
    expect(needsServerReading({ ...base, fileName: "site.png" })).toBe(false);
    expect(needsServerReading({ ...base, fileName: "archive.zip" })).toBe(false);
  });

  test("a reading replaces no text, or extends a stopped reading without moving it", async () => {
    const stopped = await browserStoppedAt(2);
    expect(stoppedEarly(stopped)).toBe(true);
    const whole = (await readFileOnServer(textPdf(PAGES), "trials.pdf")).text;
    expect(serverReadingReplaces("", whole)).toBe(true);
    expect(serverReadingReplaces("  \n", whole)).toBe(true);
    expect(serverReadingReplaces("", "   ")).toBe(false);
    expect(serverReadingReplaces(stopped, whole)).toBe(true);
    // A reading that starts differently would move every saved position.
    expect(serverReadingReplaces(stopped, ` ${whole}`)).toBe(false);
    // A reading that stops at the same page holds nothing new.
    expect(serverReadingReplaces(stopped, stopped)).toBe(false);
    // A whole text is never replaced.
    expect(serverReadingReplaces(whole, `${whole}\n\nMore.`)).toBe(false);
  });
});

describe("reading a file on the server", () => {
  test("an upload with no text is queued, read, and kept with its pages", async () => {
    const { t, projectId, writer } = await setup();
    const storageId = await store(t, textPdf(PAGES));
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.pdf",
      fileType: "pdf",
      content: "",
      storageId,
      mimeType: "application/pdf",
    });
    expect(await scheduledReadings(t)).toEqual([expect.objectContaining({ args: [{ documentId }] })]);
    expect((await fileState(t, documentId)).doc.processingStatus).not.toBe("ready");

    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    for (const page of PAGES) expect(text).toContain(page);
    expect(doc).toMatchObject({
      processingStatus: "ready",
      pageCount: 3,
      serverReader: SERVER_READER_VERSION,
      serverReadAt: expect.any(Number),
    });
    // Read once: the file is not read again.
    expect(await t.query(internal.documentReading.storedDocumentToRead, { documentId })).toBeNull();
  });

  test("an upload with text, a picture, or no original is not queued", async () => {
    const { t, projectId, writer } = await setup();
    const withText = await store(t, textPdf(PAGES));
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "read.pdf",
      fileType: "pdf",
      content: "Trial one held at 4.2 bar.",
      storageId: withText,
    });
    const picture = await t.run(async (ctx) => await ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "site.png",
      fileType: "image",
      content: "",
      storageId: picture,
    });
    await writer.mutation(api.documents.uploadDocument, { projectId, fileName: "empty.pdf", fileType: "pdf", content: "" });
    expect(await scheduledReadings(t)).toEqual([]);
  });

  test("a text-only file whose reading stopped is queued when it gains its original", async () => {
    const { t, projectId, writer } = await setup();
    const args = { projectId, fileName: "trials.pdf", fileType: "pdf" as const, content: await browserStoppedAt(2) };
    const documentId = await writer.mutation(api.documents.uploadDocument, args);
    expect(await scheduledReadings(t)).toEqual([]);
    const storageId = await store(t, textPdf(PAGES));
    expect(await writer.mutation(api.documents.uploadDocument, { ...args, storageId })).toBe(documentId);
    expect(await scheduledReadings(t)).toEqual([expect.objectContaining({ args: [{ documentId }] })]);
  });

  test("a PDF the browser stopped reading takes the server's fuller text, starting with the same characters", async () => {
    const { t, projectId, writer } = await setup();
    const stopped = await browserStoppedAt(2);
    const storageId = await store(t, textPdf(PAGES));
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.pdf",
      fileType: "pdf",
      content: stopped,
      storageId,
    });
    expect(await scheduledReadings(t)).toHaveLength(1);
    const before = await fileState(t, documentId);
    expect(before.doc.processingStatus).toBe("ready_truncated");

    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    expect(stoppedEarly(text)).toBe(false);
    expect(text).toContain(PAGES[2]);
    // Every position into the old text still lands on the same characters.
    const readSoFar = stopped.slice(0, stopped.indexOf("\n[Stopped reading"));
    expect(text.startsWith(readSoFar)).toBe(true);
    expect(doc.processingStatus).toBe("ready");
  });

  test("a reading that does not start with the stopped text is not kept, and the file is not read again", async () => {
    const { t, projectId } = await setup();
    const storageId = await store(t, textPdf(PAGES));
    const stopped = `Notes typed differently.\n\n${pdfPageStopMarker(2)}`.trim();
    const documentId = await t.run(async (ctx) => {
      const { insertDocumentWithText } = await import("./lib/documentText");
      return await insertDocumentWithText(
        ctx,
        {
          projectId,
          fileName: "trials.pdf",
          fileType: "pdf",
          storageId,
          source: "chat_upload",
          uploadedBy: "writer@banhall.com",
          createdAt: Date.now(),
        },
        stopped
      );
    });
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe(stopped);
    expect(doc.serverReadAt).toEqual(expect.any(Number));
    expect(await t.query(internal.documentReading.storedDocumentToRead, { documentId })).toBeNull();
  });

  test("a file that changed while it was read keeps its text", async () => {
    const { t, projectId, writer } = await setup();
    const storageId = await store(t, textPdf(PAGES));
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.pdf",
      fileType: "pdf",
      content: "",
      storageId,
    });
    const hashBefore = await t.run(async (ctx) => await documentTextHash((await ctx.db.get(documentId))!));
    expect(
      await t.mutation(internal.documentReading.saveServerReading, {
        documentId,
        expectedTextHash: `${hashBefore}-other`,
        text: "Trial one held at 4.2 bar.",
        reader: SERVER_READER_VERSION,
      })
    ).toBe("changed");
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe("");
    expect(doc.serverReadAt).toBeUndefined();
    // An archived file is not written either.
    await t.run(async (ctx) => await ctx.db.patch(documentId, { archived: true }));
    expect(
      await t.mutation(internal.documentReading.saveServerReading, {
        documentId,
        expectedTextHash: hashBefore,
        text: "Trial one held at 4.2 bar.",
        reader: SERVER_READER_VERSION,
      })
    ).toBe("changed");
  });

  test("a PDF with no text layer is recorded as read and left empty", async () => {
    const { t, projectId, writer } = await setup();
    const storageId = await store(t, textPdf([""]));
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "scan.pdf",
      fileType: "pdf",
      content: "",
      storageId,
    });
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe("");
    expect(doc.serverReader).toBe(SERVER_READER_VERSION);
  });
});

describe("a file too big to read on the server", () => {
  test("is recorded as read without being downloaded, and keeps its text", async () => {
    const { t, projectId } = await setup();
    const { MAX_SERVER_READ_BYTES } = await import("./ai/fileReading");
    // Uploads are refused above the limit; a file from before may not be.
    const storageId = await store(t, new Uint8Array(MAX_SERVER_READ_BYTES + 1));
    const { insertDocumentWithText } = await import("./lib/documentText");
    const documentId = await t.run(
      async (ctx) =>
        await insertDocumentWithText(
          ctx,
          {
            projectId,
            fileName: "huge.pdf",
            fileType: "pdf",
            storageId,
            source: "chat_upload",
            uploadedBy: "writer@banhall.com",
            createdAt: Date.now(),
          },
          ""
        )
    );
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe("");
    expect(doc.serverReadAt).toEqual(expect.any(Number));
  });
});

describe("the one-off pass over existing files", () => {
  test("counts on a dry run, then queues each file that needs a reading, spaced apart", async () => {
    const { t, projectId } = await setup();
    const { insertDocumentWithText } = await import("./lib/documentText");
    const ids = await t.run(async (ctx) => {
      const ids: Id<"projectDocuments">[] = [];
      for (const [fileName, text, withOriginal] of [
        ["a.pdf", "", true],
        ["b.pdf", "Read already.", true],
        ["c.pdf", "", false],
        ["d.docx", "", true],
      ] as const) {
        const storageId = withOriginal ? await ctx.storage.store(new Blob(["x"])) : undefined;
        ids.push(
          await insertDocumentWithText(
            ctx,
            {
              projectId,
              fileName,
              fileType: fileName.endsWith(".pdf") ? "pdf" : "docx",
              ...(storageId ? { storageId } : {}),
              source: "chat_upload",
              uploadedBy: "writer@banhall.com",
              createdAt: Date.now(),
            },
            text
          )
        );
      }
      return ids;
    });
    expect(await t.mutation(internal.documentReading.queueServerReadings, { dryRun: true })).toEqual({
      queued: 2,
      isDone: true,
    });
    expect(await scheduledReadings(t)).toEqual([]);
    expect(await t.mutation(internal.documentReading.queueServerReadings, {})).toEqual({ queued: 2, isDone: true });
    const jobs = await scheduledReadings(t);
    expect(jobs.map((job) => job.args[0])).toEqual([{ documentId: ids[0] }, { documentId: ids[3] }]);
    expect(jobs[1]!.scheduledTime - jobs[0]!.scheduledTime).toBeGreaterThanOrEqual(2_000);
  });
});
