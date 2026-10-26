/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase B2): the server reads a project file's stored original
 * when nothing came out of it in the browser, and keeps its reading only for
 * a file with nothing read. A file with read text keeps it until text
 * versions (Phase B1).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { pdfPageStopMarker } from "../shared/documentStatus";
import { documentTextHash, readDocumentText } from "./lib/documentText";
import { hasReadText, needsServerReading, serverReadingReplaces } from "./lib/serverReading";
import { insertDocumentWithText } from "./lib/documentText";
import { readFileOnServer, SERVER_READER_VERSION } from "./ai/fileReader";
import { RICH_WORD_MARKDOWN, richWordFile, textPdf } from "./ai/testFiles.fixture";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-document-reading-tests";

const PAGES = ["Trial one held at 4.2 bar.", "Trial two failed at 3.1 bar.", "Trial three held at 5.0 bar."];
const KEY = "33333333-3333-4333-8333-333333333333";

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
  test("only a supported, stored, unread file with nothing read", () => {
    const storageId = "storage" as Id<"_storage">;
    const base = { fileName: "trials.pdf", storageId, hasReadText: false };
    expect(needsServerReading(base)).toBe(true);
    expect(needsServerReading({ ...base, hasReadText: true })).toBe(false);
    expect(needsServerReading({ ...base, storageId: undefined })).toBe(false);
    expect(needsServerReading({ ...base, archived: true })).toBe(false);
    // Read, or started and stopped, by this reader: not again.
    expect(needsServerReading({ ...base, serverReader: SERVER_READER_VERSION, serverReadAt: 1 })).toBe(false);
    expect(needsServerReading({ ...base, serverReader: SERVER_READER_VERSION, serverReadStartedAt: 1 })).toBe(false);
    // An older reader's attempt does not count.
    expect(needsServerReading({ ...base, serverReader: "server-reader-0", serverReadAt: 1 })).toBe(true);
    expect(needsServerReading({ ...base, fileName: "site.png" })).toBe(false);
    expect(needsServerReading({ ...base, fileName: "archive.zip" })).toBe(false);
  });

  test("a stop line alone is nothing read; pages before it are", async () => {
    expect(hasReadText("")).toBe(false);
    expect(hasReadText(" \n ")).toBe(false);
    // The first page ran out of time: the trimmed text is the stop line.
    expect(hasReadText(pdfPageStopMarker(1).trim())).toBe(false);
    expect(hasReadText(await browserStoppedAt(2))).toBe(true);
    expect(hasReadText("Trial one held at 4.2 bar.")).toBe(true);
  });

  test("a reading replaces only a file with nothing read, and only with read text", async () => {
    const whole = (await readFileOnServer(textPdf(PAGES), "trials.pdf")).text;
    expect(serverReadingReplaces(false, whole)).toBe(true);
    expect(serverReadingReplaces(false, "   ")).toBe(false);
    expect(serverReadingReplaces(false, pdfPageStopMarker(1).trim())).toBe(false);
    // A file with read text keeps it, even a PDF the browser stopped part way.
    expect(serverReadingReplaces(true, whole)).toBe(false);
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
    expect(await t.mutation(internal.documentReading.startServerReading, { documentId })).toBeNull();
  });

  test("a Word file with no text is read as Markdown and keeps its flag", async () => {
    // Zip reading waits on real timers; the reading the upload queued runs on its own.
    vi.useRealTimers();
    const { t, projectId, writer } = await setup();
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.docx",
      fileType: "docx",
      content: "",
      storageId: await store(t, await richWordFile()),
    });
    await vi.waitFor(async () => expect((await fileState(t, documentId)).doc.serverReadAt).toEqual(expect.any(Number)), {
      timeout: 15_000,
      interval: 100,
    });
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe(RICH_WORD_MARKDOWN);
    expect(doc).toMatchObject({ textFormat: "markdown", serverReader: SERVER_READER_VERSION, processingStatus: "ready" });
  });

  test("a PDF whose first page ran out of time in the browser is read", async () => {
    const { t, projectId, writer } = await setup();
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.pdf",
      fileType: "pdf",
      content: pdfPageStopMarker(1).trim(),
      storageId: await store(t, textPdf(PAGES)),
    });
    expect(await scheduledReadings(t)).toHaveLength(1);
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { text } = await fileState(t, documentId);
    expect(text).toContain(PAGES[2]);
    expect(hasReadText(text)).toBe(true);
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

  test("a retried upload that brings the original of a file with nothing read queues the reading", async () => {
    const { t, projectId, writer } = await setup();
    await writer.mutation(api.uploadAttempts.recordUploadAttempts, {
      projectId,
      attempts: [{ attemptKey: KEY, fileName: "trials.pdf", fileSizeBytes: 1234, origin: "chat_upload" }],
    });
    // The browser gave up before page 1: only its stop line was kept.
    const args = {
      projectId,
      fileName: "trials.pdf",
      fileType: "pdf" as const,
      content: pdfPageStopMarker(1).trim(),
      attemptKey: KEY,
    };
    const documentId = await writer.mutation(api.documents.uploadDocument, args);
    expect(await scheduledReadings(t)).toEqual([]);
    const storageId = await store(t, textPdf(PAGES));
    expect(await writer.mutation(api.documents.uploadDocument, { ...args, storageId })).toBe(documentId);
    expect(await scheduledReadings(t)).toEqual([expect.objectContaining({ args: [{ documentId }] })]);
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    expect((await fileState(t, documentId)).text).toContain(PAGES[0]);
    // A retry after the server filled it in still finds the same file.
    expect(await writer.mutation(api.documents.uploadDocument, { ...args, storageId })).toBe(documentId);
  });

  test("two files with nothing read but the same stop line stay two files", async () => {
    const { t, projectId, writer } = await setup();
    const args = { projectId, fileName: "scan.pdf", fileType: "pdf" as const, content: pdfPageStopMarker(1).trim() };
    const first = await writer.mutation(api.documents.uploadDocument, {
      ...args,
      storageId: await store(t, textPdf(["One."])),
    });
    const second = await writer.mutation(api.documents.uploadDocument, {
      ...args,
      storageId: await store(t, textPdf(["Two."])),
    });
    expect(second).not.toBe(first);
    expect(await scheduledReadings(t)).toHaveLength(2);
  });

  test("a PDF the browser stopped part way keeps its text and is not queued (text versions come later)", async () => {
    const { t, projectId, writer } = await setup();
    const stopped = await browserStoppedAt(2);
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "trials.pdf",
      fileType: "pdf",
      content: stopped,
      storageId: await store(t, textPdf(PAGES)),
    });
    expect(await scheduledReadings(t)).toEqual([]);
    // Even read on purpose, its text and fingerprint stay.
    const hashBefore = await t.run(async (ctx) => await documentTextHash((await ctx.db.get(documentId))!));
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe(stopped);
    expect(await documentTextHash(doc)).toBe(hashBefore);
    expect(doc.processingStatus).toBe("ready_truncated");
    expect(doc.serverReadAt).toBeUndefined();
  });

  test("a reading saved for a file that has read text is not kept, and the file is marked read", async () => {
    const { t, projectId } = await setup();
    const storageId = await store(t, textPdf(PAGES));
    const stored = "Notes typed by hand.";
    const documentId = await t.run(
      async (ctx) =>
        await insertDocumentWithText(
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
          stored
        )
    );
    const textHash = await t.run(async (ctx) => await documentTextHash((await ctx.db.get(documentId))!));
    expect(
      await t.mutation(internal.documentReading.saveServerReading, {
        documentId,
        expectedTextHash: textHash,
        text: PAGES.join("\n\n"),
        reader: SERVER_READER_VERSION,
      })
    ).toBe("not_better");
    const { doc, text } = await fileState(t, documentId);
    expect(text).toBe(stored);
    expect(doc.serverReadAt).toEqual(expect.any(Number));
    expect(await t.mutation(internal.documentReading.startServerReading, { documentId })).toBeNull();
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

describe("claims, failures and rows that still hold their text", () => {
  /** A file row written the way rows were before their text moved to pieces. */
  async function legacyRow(t: Setup["t"], projectId: Id<"projects">, content: string, storageId: Id<"_storage">) {
    return await t.run(
      async (ctx) =>
        await ctx.db.insert("projectDocuments", {
          projectId,
          fileName: "trials.pdf",
          fileType: "pdf",
          content,
          storageId,
          source: "chat_upload",
          uploadedBy: "writer@banhall.com",
          createdAt: Date.now(),
        })
    );
  }

  test("a reader that fails releases its claim, so a later pass may try again", async () => {
    const { t, projectId, writer } = await setup();
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["not a zip"])));
    const documentId = await writer.mutation(api.documents.uploadDocument, {
      projectId,
      fileName: "notes.docx",
      fileType: "docx",
      content: "",
      storageId,
    });
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc } = await fileState(t, documentId);
    expect(doc.serverReadAt).toBeUndefined();
    expect(doc.serverReadStartedAt).toBeUndefined();
    expect(await t.mutation(internal.documentReading.startServerReading, { documentId })).not.toBeNull();
  });

  test("a reading that started and never finished is not claimed again by the same reader", async () => {
    const { t, projectId } = await setup();
    const documentId = await legacyRow(t, projectId, "", await store(t, textPdf(PAGES)));
    expect(await t.mutation(internal.documentReading.startServerReading, { documentId })).not.toBeNull();
    // Its action was stopped: no save came.
    expect(await t.mutation(internal.documentReading.startServerReading, { documentId })).toBeNull();
    expect(await t.mutation(internal.documentReading.queueServerReadings, { dryRun: true })).toEqual({ queued: 0, isDone: true });
  });

  test("a row that still holds its text drops it when the reading is kept, and takes the page count for chat", async () => {
    const { t, projectId } = await setup();
    const storageId = await store(t, textPdf(PAGES));
    const documentId = await legacyRow(t, projectId, pdfPageStopMarker(1).trim(), storageId);
    await t.action(internal.ai.fileReading.readStoredDocument, { documentId });
    const { doc, text } = await fileState(t, documentId);
    expect(doc.content).toBeUndefined();
    expect(doc.textMovedAt).toEqual(expect.any(Number));
    expect(text).toContain(PAGES[1]);
    expect(doc).toMatchObject({ pageCount: 3, pageCountStorageId: storageId });
    const pieces = await t.run(async (ctx) =>
      ctx.db
        .query("projectDocumentTexts")
        .withIndex("by_documentId_and_start", (q) => q.eq("documentId", documentId))
        .collect()
    );
    expect(pieces.map((piece) => piece.text).join("")).toBe(text);
  });

  test("nothing is written once the project is being erased", async () => {
    const { t, projectId } = await setup();
    const documentId = await legacyRow(t, projectId, "", await store(t, textPdf(PAGES)));
    const target = await t.mutation(internal.documentReading.startServerReading, { documentId });
    await t.run(async (ctx) => await ctx.db.patch(projectId, { deletionStartedAt: Date.now() }));
    expect(
      await t.mutation(internal.documentReading.saveServerReading, {
        documentId,
        expectedTextHash: target!.textHash,
        text: PAGES.join("\n\n"),
        reader: SERVER_READER_VERSION,
      })
    ).toBe("changed");
    expect((await fileState(t, documentId)).text).toBe("");
    // And no new reading starts for it.
    await t.run(async (ctx) => await ctx.db.patch(documentId, { serverReadStartedAt: undefined }));
    expect(await t.mutation(internal.documentReading.startServerReading, { documentId })).toBeNull();
  });
});

describe("a file too big to read on the server", () => {
  test("is recorded as read without being downloaded, and keeps its text", async () => {
    const { t, projectId } = await setup();
    const { MAX_SERVER_READ_BYTES } = await import("./ai/fileReading");
    // Uploads are refused above the limit; a file from before may not be.
    const storageId = await store(t, new Uint8Array(MAX_SERVER_READ_BYTES + 1));
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
  test("walks every page and logs the whole count", async () => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        await insertDocumentWithText(
          ctx,
          {
            projectId,
            fileName: `f${i}.pdf`,
            fileType: "pdf",
            storageId: await ctx.storage.store(new Blob(["x"])),
            source: "chat_upload",
            uploadedBy: "writer@banhall.com",
            createdAt: Date.now(),
          },
          ""
        );
      }
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await t.mutation(internal.documentReading.queueServerReadings, { dryRun: true })).toEqual({
        queued: 50,
        isDone: false,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(info).toHaveBeenCalledWith("queueServerReadings: would queue 60 server readings in all");
      expect(await scheduledReadings(t)).toEqual([]);
    } finally {
      info.mockRestore();
    }
  });

  test("counts on a dry run, then queues each file that needs a reading, spaced apart", async () => {
    const { t, projectId } = await setup();
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
