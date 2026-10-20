/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { CHAT_DOCUMENT_TOOLS_KEY, CHAT_VISION_KEY } from "./appSettings";
import { countPdfPagesWithPdfJs } from "./ai/chatPdfPages";

/**
 * Report chat parity, Phase C (2026-10-20), W1: the page count path. The
 * first view of a PDF with no stored count counts its pages on the server
 * with pdf.js and stores the count; viewFileForChat then hands it back. The
 * PDFs are built here and hold nothing but empty pages.
 */

const modules = import.meta.glob("./**/*.ts");

type ViewArgs = { agentThreadId: string; documentId: Id<"projectDocuments"> };
type CountArgs = { documentId: Id<"projectDocuments">; storageId: Id<"_storage"> };
const viewFileForChat = makeFunctionReference<"query", ViewArgs, Record<string, unknown>>("chatDocuments:viewFileForChat");
const countPdfPages = makeFunctionReference<"action", CountArgs, number | null>("ai/chatPdfPages:countPdfPages");
const storePdfPageCount = makeFunctionReference<"mutation", CountArgs & { pageCount: number }, null>(
  "chatDocuments:storePdfPageCount"
);

/** A minimal valid PDF of `pages` empty pages, with a correct cross-reference table. */
function emptyPdf(pages: number): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "auth-pages", role: "writer" });
    const project = (title: string) =>
      ctx.db.insert("projects", {
        title, clientName: "Client", status: "review", createdBy: userId, ownerId: userId,
        shareToken: `${title}-token`, createdAt: now, updatedAt: now,
      });
    const projectId = await project("Pages");
    const otherProjectId = await project("Other");
    const reportId = await ctx.db.insert("reports", {
      projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "thread-pages", title: "Pages", createdAt: now });
    const pdfStorage = await ctx.storage.store(new Blob([emptyPdf(3)], { type: "application/pdf" }));
    const file = (fileName: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "pdf", content: "", source: "upload", uploadedBy: "writer", createdAt: now, ...extra,
      });
    const scanId = await file("scan.pdf", { storageId: pdfStorage });
    const noOriginalId = await file("no-original.pdf");
    const notesId = await file("notes.txt", { fileType: "txt", content: "Notes.", storageId: pdfStorage });
    const archivedId = await file("archived.pdf", { storageId: pdfStorage, archived: true });
    const otherId = await file("other.pdf", { storageId: pdfStorage, projectId: otherProjectId });
    return { userId, scanId, noOriginalId, notesId, archivedId, otherId, pdfStorage };
  });
  return { t, ...ids };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("PDF page counts", () => {
  test("pdf.js counts pages, and says null for bytes that are not a PDF", async () => {
    expect(await countPdfPagesWithPdfJs(emptyPdf(7))).toBe(7);
    expect(await countPdfPagesWithPdfJs(new TextEncoder().encode("not a pdf"))).toBeNull();
  });

  test("are counted on the first view and stored, then handed back without counting", async () => {
    const f = await setup();
    const first = await f.t.query(viewFileForChat, { agentThreadId: "thread-pages", documentId: f.scanId });
    expect(first).toEqual({
      status: "ok", fileName: "scan.pdf", kind: "pdf", mediaType: "application/pdf",
      storageId: f.pdfStorage, size: emptyPdf(3).length,
    });
    expect(await f.t.action(countPdfPages, { documentId: f.scanId, storageId: f.pdfStorage })).toBe(3);
    expect(await f.t.run(async (ctx) => (await ctx.db.get(f.scanId))?.pageCount)).toBe(3);
    const second = await f.t.query(viewFileForChat, { agentThreadId: "thread-pages", documentId: f.scanId });
    expect(second).toMatchObject({ status: "ok", pageCount: 3 });
  });

  // Review R1 P3-5: a public path (projects.ts, copied originals) can repoint
  // a row's original without clearing its count.
  test("are not handed back once the row's original changed, until counted again", async () => {
    const f = await setup();
    await f.t.action(countPdfPages, { documentId: f.scanId, storageId: f.pdfStorage });
    const otherStorage = await f.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([emptyPdf(40)], { type: "application/pdf" }));
      await ctx.db.patch(f.scanId, { storageId });
      return storageId;
    });
    const stale = await f.t.query(viewFileForChat, { agentThreadId: "thread-pages", documentId: f.scanId });
    expect(stale).toMatchObject({ status: "ok", storageId: otherStorage });
    expect(stale).not.toHaveProperty("pageCount");
    expect(await f.t.action(countPdfPages, { documentId: f.scanId, storageId: otherStorage })).toBe(40);
    expect(await f.t.query(viewFileForChat, { agentThreadId: "thread-pages", documentId: f.scanId })).toMatchObject({
      pageCount: 40,
    });
  });

  test("are stored only on the original that was counted", async () => {
    const f = await setup();
    const otherStorage = await f.t.run(async (ctx) => await ctx.storage.store(new Blob([emptyPdf(1)])));
    await f.t.mutation(storePdfPageCount, { documentId: f.scanId, storageId: otherStorage, pageCount: 9 });
    await f.t.mutation(storePdfPageCount, { documentId: f.notesId, storageId: f.pdfStorage, pageCount: 9 });
    const counts = await f.t.run(async (ctx) => [
      (await ctx.db.get(f.scanId))?.pageCount ?? null,
      (await ctx.db.get(f.notesId))?.pageCount ?? null,
    ]);
    expect(counts).toEqual([null, null]);
  });
});

describe("viewFileForChat", () => {
  test("answers only for the thread's project, files with a PDF or image original, and the settings", async () => {
    const f = await setup();
    const view = (documentId: Id<"projectDocuments">, agentThreadId = "thread-pages") =>
      f.t.query(viewFileForChat, { agentThreadId, documentId });
    expect(await view(f.noOriginalId)).toEqual({ status: "not_media", fileName: "no-original.pdf" });
    expect(await view(f.notesId)).toEqual({ status: "not_media", fileName: "notes.txt" });
    expect(await view(f.archivedId)).toEqual({ status: "not_found" });
    expect(await view(f.otherId)).toEqual({ status: "not_found" });
    expect(await view(f.scanId, "thread-unknown")).toEqual({ status: "unavailable" });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", { key: CHAT_VISION_KEY, value: "off", updatedAt: Date.now(), updatedBy: f.userId });
    });
    expect(await view(f.scanId)).toEqual({ status: "vision_off" });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", { key: CHAT_DOCUMENT_TOOLS_KEY, value: "off", updatedAt: Date.now(), updatedBy: f.userId });
    });
    expect(await view(f.scanId)).toEqual({ status: "off" });
  });
});
