/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase B4): every text write marks a file due, the sweep cuts
 * its search pieces, and a search within one project finds them, never
 * returning positions into text that has changed.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { documentTextHash, insertDocumentWithText, readDocumentText, writeDocumentText } from "./lib/documentText";
import { SEARCH_PIECES_VERSION } from "../shared/searchPieces";
import { readFileOnServer } from "./ai/fileReader";
import { textPdf } from "./ai/testFiles.fixture";

const modules = import.meta.glob("./**/*.ts");
const writerAuthId = "auth-writer-search-pieces";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const paragraph = (topic: string, n: number) =>
  `The ${topic} trial ${n} ran the seal at a new pressure and logged the leak rate each hour for the full shift. `.repeat(4);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: writerAuthId, email: "writer@banhall.com", role: "writer" });
    const project = (title: string) =>
      ctx.db.insert("projects", {
        title, clientName: "Client", status: "draft", createdBy: writerId, ownerId: writerId,
        shareToken: `${title}-token`, createdAt: now, updatedAt: now,
      });
    return { projectId: await project("Seal"), otherProjectId: await project("Other") };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: writerAuthId }) };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function addFile(
  s: Setup,
  projectId: Id<"projects">,
  fileName: string,
  text: string,
  extra: { fileType?: "txt" | "pdf" | "docx"; storageId?: Id<"_storage">; textFormat?: "markdown" } = {}
) {
  return await s.t.run(
    async (ctx) =>
      await insertDocumentWithText(
        ctx,
        {
          projectId,
          fileName,
          fileType: extra.fileType ?? "txt",
          ...(extra.storageId ? { storageId: extra.storageId } : {}),
          ...(extra.textFormat ? { textFormat: extra.textFormat } : {}),
          source: "chat_upload",
          uploadedBy: "writer@banhall.com",
          createdAt: Date.now(),
        },
        text
      )
  );
}

/** What the sweep starts, run to the end. */
async function sweep(s: Setup) {
  await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {});
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function piecesOf(s: Setup, documentId: Id<"projectDocuments">) {
  return await s.t.run(async (ctx) =>
    ctx.db.query("documentSearchPieces").withIndex("by_documentId_and_order", (q) => q.eq("documentId", documentId)).collect()
  );
}

describe("cutting a file's search pieces", () => {
  test("a new file is due; the sweep cuts pieces that cover its text exactly, with its fingerprint", async () => {
    const s = await setup();
    const text = Array.from({ length: 30 }, (_, i) => paragraph("cold soak", i)).join("\n\n");
    const documentId = await addFile(s, s.projectId, "log.txt", text);
    expect((await s.t.run(async (ctx) => ctx.db.get(documentId)))?.searchPiecesDue).toBe(true);
    await sweep(s);
    const doc = (await s.t.run(async (ctx) => ctx.db.get(documentId)))!;
    const hash = await documentTextHash(doc);
    expect(doc).toMatchObject({ searchPiecesTextHash: hash, searchPiecesVersion: SEARCH_PIECES_VERSION });
    expect(doc.searchPiecesDue).toBeUndefined();
    expect(doc.searchPiecesNextAt).toBeUndefined();
    const pieces = await piecesOf(s, documentId);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces[0]!.start).toBe(0);
    expect(pieces.at(-1)!.end).toBe(text.length);
    for (const [i, piece] of pieces.entries()) {
      expect(piece.textHash).toBe(hash);
      if (i > 0) expect(piece.start).toBe(pieces[i - 1]!.end);
      expect(piece.searchText.slice(piece.prefixChars)).toBe(text.slice(piece.start, piece.end));
    }
  });

  test("a PDF gets page numbers when reading its original again gives exactly its text", async () => {
    const s = await setup();
    const bytes = textPdf(["Page one says the seal held.", "Page two says the gasket cracked.", "Page three says it was fixed."]);
    const reading = await readFileOnServer(bytes, "trials.pdf");
    const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob([bytes as BlobPart])));
    const exact = await addFile(s, s.projectId, "trials.pdf", reading.text, { fileType: "pdf", storageId });
    // A file whose stored text differs from the reading gets no page numbers.
    const otherStorage = await s.t.run(async (ctx) => ctx.storage.store(new Blob([bytes as BlobPart])));
    const edited = await addFile(s, s.projectId, "edited.pdf", `${reading.text} Edited.`, { fileType: "pdf", storageId: otherStorage });
    await sweep(s);
    expect(await piecesOf(s, exact)).toEqual([expect.objectContaining({ page: 1, pageEnd: 3 })]);
    const [plain] = await piecesOf(s, edited);
    expect(plain!.page).toBeUndefined();
  });

  test("Word Markdown is searched without its marks and labelled by its headings", async () => {
    const s = await setup();
    const markdown = `# Seal trials\n\n${paragraph("**bold**", 1)}\n\n## Method\n\n${paragraph("cold", 2)}`;
    const documentId = await addFile(s, s.projectId, "trials.docx", markdown, { fileType: "docx", textFormat: "markdown" });
    await sweep(s);
    const pieces = await piecesOf(s, documentId);
    expect(pieces.map((piece) => piece.searchText).join("")).not.toContain("**");
    expect(pieces[0]!.label).toBe("Seal trials");
  });

  test("nothing is written when the text changed after the cut started, or the project is being erased", async () => {
    const s = await setup();
    const documentId = await addFile(s, s.projectId, "log.txt", paragraph("seal", 1));
    const hash = await s.t.run(async (ctx) => documentTextHash((await ctx.db.get(documentId))!));
    expect(await s.t.mutation(internal.searchPieces.writeSearchPieces, { documentId, textHash: `${hash}-old` })).toBe("changed");
    expect(await piecesOf(s, documentId)).toEqual([]);
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { deletionStartedAt: Date.now() }));
    expect(await s.t.mutation(internal.searchPieces.writeSearchPieces, { documentId, textHash: hash })).toBe("changed");
    expect(await piecesOf(s, documentId)).toEqual([]);
  });

  test("new text removes the old pieces at once and marks the file due again", async () => {
    const s = await setup();
    const documentId = await addFile(s, s.projectId, "log.txt", paragraph("seal", 1));
    await sweep(s);
    expect((await piecesOf(s, documentId)).length).toBe(1);
    await s.t.run(async (ctx) => {
      const doc = (await ctx.db.get(documentId))!;
      await ctx.db.patch(documentId, await writeDocumentText(ctx, doc, paragraph("gasket", 2)));
    });
    expect(await piecesOf(s, documentId)).toEqual([]);
    expect((await s.t.run(async (ctx) => ctx.db.get(documentId)))?.searchPiecesDue).toBe(true);
    await sweep(s);
    const [piece] = await piecesOf(s, documentId);
    expect(piece!.searchText).toContain("gasket");
  });

  test("a removed file's pieces go with it", async () => {
    const s = await setup();
    const documentId = await s.writer.mutation(api.documents.uploadDocument, {
      projectId: s.projectId,
      fileName: "log.txt",
      fileType: "txt",
      content: paragraph("seal", 1),
    });
    await sweep(s);
    expect((await piecesOf(s, documentId)).length).toBe(1);
    await s.writer.mutation(api.documents.deleteDocument, { documentId });
    expect(await piecesOf(s, documentId)).toEqual([]);
  });
});

describe("searching a project's pieces", () => {
  test("finds the matching piece within the project only, at most two of a file, with its fingerprint", async () => {
    const s = await setup();
    const many = Array.from({ length: 12 }, (_, i) => paragraph(`fluoropolymer ${i}`, i)).join("\n\n");
    const big = await addFile(s, s.projectId, "big.txt", many);
    const small = await addFile(s, s.projectId, "small.txt", paragraph("fluoropolymer gasket", 1));
    await addFile(s, s.otherProjectId, "other.txt", paragraph("fluoropolymer elsewhere", 1));
    await sweep(s);
    const result = await s.t.query(internal.searchPieces.searchProject, { projectId: s.projectId, query: "fluoropolymer seal" });
    expect(result.complete).toBe(true);
    expect(new Set(result.hits.map((hit) => hit.fileName))).toEqual(new Set(["big.txt", "small.txt"]));
    expect(result.hits.filter((hit) => hit.documentId === big).length).toBeLessThanOrEqual(2);
    const hit = result.hits.find((item) => item.documentId === small)!;
    const text = await s.t.run(async (ctx) => readDocumentText(ctx, (await ctx.db.get(small))!));
    expect(hit.text).toBe(text.slice(hit.start, hit.end));
    expect(hit.textHash).toBe(await s.t.run(async (ctx) => documentTextHash((await ctx.db.get(small))!)));
  });

  test("leaves out archived files and pieces cut from older text, and says when files are not indexed yet", async () => {
    const s = await setup();
    const archived = await addFile(s, s.projectId, "archived.txt", paragraph("fluoropolymer", 1));
    const stale = await addFile(s, s.projectId, "stale.txt", paragraph("fluoropolymer", 2));
    await sweep(s);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(archived, { archived: true });
      // Pieces left from an older text (a write that bypassed the helpers).
      for (const piece of await ctx.db.query("documentSearchPieces").withIndex("by_documentId_and_order", (q) => q.eq("documentId", stale)).collect()) {
        await ctx.db.patch(piece._id, { textHash: "older" });
      }
    });
    await addFile(s, s.projectId, "waiting.txt", paragraph("fluoropolymer", 3));
    const result = await s.t.query(internal.searchPieces.searchProject, { projectId: s.projectId, query: "fluoropolymer" });
    expect(result.hits).toEqual([]);
    expect(result.complete).toBe(false);
  });
});

describe("query words (review, 2026-10-26)", () => {
  test("split as Convex splits them, at most 16, no stop words, no word over 32 characters", async () => {
    const { searchTerms } = await import("./lib/searchPieces");
    expect(searchTerms("The fluoro-polymer seal's R&D at 4.2 bar")).toEqual(["bar", "seal", "fluoro", "polymer"]);
    const hyphens = Array.from({ length: 9 }, (_, i) => `alpha${i}-beta${i}`).join(" ");
    expect(searchTerms(hyphens)).toHaveLength(16);
    expect(searchTerms(`${"x".repeat(33)} gasket`)).toEqual(["gasket"]);
  });

  test("a search that read its whole scan cap with fewer hits than asked says it may be incomplete", async () => {
    const s = await setup();
    // One file whose 70 pieces all match fills the scan (64 at the default
    // limit of 8); only two of its pieces may be hits.
    const big = Array.from({ length: 70 }, (_, i) => paragraph(`fluoropolymer ${i}`, i).repeat(5)).join("\n\n");
    await addFile(s, s.projectId, "big.txt", big);
    await sweep(s);
    const result = await s.t.query(internal.searchPieces.searchProject, { projectId: s.projectId, query: "fluoropolymer" });
    expect(result.hits.length).toBeLessThan(8);
    expect(result.complete).toBe(false);
  });
});

describe("the sweep and the one-off pass", () => {
  test("the sweep claims each due file once, and a stopped claim is taken again later", async () => {
    const s = await setup();
    const documentId = await addFile(s, s.projectId, "log.txt", paragraph("seal", 1));
    expect(await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {})).toBe(1);
    expect(await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {})).toBe(0);
    // The first claim's indexing never runs (as if stopped): after ten minutes the file is claimed again.
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
    });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {})).toBe(1);
    expect((await s.t.run(async (ctx) => ctx.db.get(documentId)))?.searchPiecesNextAt).toBeGreaterThan(Date.now());
  });

  test("the backfill marks files with text and no current pieces", async () => {
    const s = await setup();
    const indexed = await addFile(s, s.projectId, "indexed.txt", paragraph("seal", 1));
    await sweep(s);
    const old = await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "old.txt", fileType: "txt", content: paragraph("old", 1),
        source: "chat_upload", uploadedBy: "writer@banhall.com", createdAt: Date.now(),
      })
    );
    await s.t.run(async (ctx) =>
      ctx.db.insert("projectDocuments", {
        projectId: s.projectId, fileName: "empty.txt", fileType: "txt", content: "",
        source: "chat_upload", uploadedBy: "writer@banhall.com", createdAt: Date.now(),
      })
    );
    expect(await s.t.mutation(internal.searchPieces.markSearchPiecesDue, { dryRun: true })).toEqual({ marked: 1, isDone: true });
    expect(await s.t.mutation(internal.searchPieces.markSearchPiecesDue, {})).toEqual({ marked: 1, isDone: true });
    expect((await s.t.run(async (ctx) => ctx.db.get(old)))?.searchPiecesDue).toBe(true);
    expect((await s.t.run(async (ctx) => ctx.db.get(indexed)))?.searchPiecesDue).toBeUndefined();
  });
});
