/// <reference types="vite/client" />
/**
 * 2026-10-22 (fourth): a file's text in pieces reads back exactly as
 * `content.slice` did, never splits a character when stored, and goes with
 * its file.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { sha256 } from "./contracts";
import {
  DOCUMENT_TEXT_PIECE_CHARS,
  DOCUMENT_TEXT_PREVIEW_CHARS,
  documentHasText,
  documentTextFacts,
  documentTextLength,
  documentTextPieceEnds,
  readDocumentText,
  writeDocumentText,
} from "./documentText";

const modules = import.meta.glob("../**/*.ts");
const writerAuthId = "auth-writer-document-text";

async function setup() {
  const t = convexTest(schema, modules);
  const { projectId } = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: writerAuthId, email: "writer@banhall.com", role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Text project",
      clientName: "Client",
      status: "draft",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "text-project-token",
      createdAt: now,
      updatedAt: now,
    });
    return { projectId };
  });
  const insertDocument = (content: string) =>
    t.run(async (ctx) => await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "notes.txt",
      fileType: "txt",
      content,
      source: "chat_upload",
      uploadedBy: "writer@banhall.com",
      createdAt: Date.now(),
    }));
  return { t, projectId, insertDocument, writer: t.withIdentity({ subject: writerAuthId }) };
}

/** Moves a row's text into pieces, as the writers and the backfill do. */
async function move(t: Awaited<ReturnType<typeof setup>>["t"], documentId: Id<"projectDocuments">, text: string) {
  await t.run(async (ctx) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new Error("missing");
    await ctx.db.patch(documentId, await writeDocumentText(ctx, doc, text));
  });
}

// An emoji (a surrogate pair) at each piece edge, and at 199,999 / 200,000,
// where generation freezes its 200,000-character slice.
function textWithPairsAtEdges(length: number): string {
  const chars = Array.from({ length }, (_, index) => String.fromCharCode(97 + (index % 26)));
  for (const at of [DOCUMENT_TEXT_PIECE_CHARS - 1, 2 * DOCUMENT_TEXT_PIECE_CHARS - 1, 199_999]) {
    if (at + 1 < length) {
      chars[at] = "\ud83d";
      chars[at + 1] = "\ude00";
    }
  }
  return chars.join("");
}

describe("document text pieces (2026-10-22, fourth)", () => {
  test("never splits a character when cut into pieces", () => {
    const text = textWithPairsAtEdges(DOCUMENT_TEXT_PIECE_CHARS * 3);
    const ends = documentTextPieceEnds(text);
    let at = 0;
    for (const end of ends) {
      const piece = text.slice(at, end);
      const last = piece.charCodeAt(piece.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(piece.length).toBeLessThanOrEqual(DOCUMENT_TEXT_PIECE_CHARS);
      at = end;
    }
    expect(at).toBe(text.length);
    // The first edge moved back by one to keep its pair whole.
    expect(ends[0]).toBe(DOCUMENT_TEXT_PIECE_CHARS - 1);
    expect(documentTextPieceEnds("")).toEqual([]);
  });

  test("reads back exactly what content.slice returns, for any range", async () => {
    const { t, insertDocument } = await setup();
    const text = textWithPairsAtEdges(210_000);
    const documentId = await insertDocument(text);
    await move(t, documentId, text);
    const ranges: Array<[number, number | undefined]> = [
      [0, undefined],
      [0, 200_000],
      [199_999, 200_001],
      [DOCUMENT_TEXT_PIECE_CHARS - 1, DOCUMENT_TEXT_PIECE_CHARS + 1],
      [DOCUMENT_TEXT_PIECE_CHARS * 2, DOCUMENT_TEXT_PIECE_CHARS * 2],
      [5, 3],
      [205_000, 400_000],
      [400_000, 500_000],
      [-10, undefined],
    ];
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) % 215_000;
    for (let index = 0; index < 40; index += 1) {
      const a = random();
      ranges.push([a, a + (random() % 50_000)]);
    }
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(documentId);
      if (!doc) throw new Error("missing");
      for (const [start, end] of ranges) {
        expect(await readDocumentText(ctx, doc, start, end), `${start}..${end}`).toBe(text.slice(start, end));
      }
      expect(documentTextLength(doc)).toBe(text.length);
      expect(documentHasText(doc)).toBe(true);
    });
  });

  test("keeps the facts a row needs and reads an unmoved row from its content", async () => {
    const { t, insertDocument } = await setup();
    const text = `\n\n  Opening line.\n${"word ".repeat(1_000)}`;
    expect(await documentTextFacts(text)).toEqual({
      textLength: text.length,
      hasText: true,
      textHash: await sha256(text),
      textPreview: text.trimStart().slice(0, DOCUMENT_TEXT_PREVIEW_CHARS),
      wordCount: 1_002,
    });
    expect((await documentTextFacts(" \n\t ")).hasText).toBe(false);
    const unmoved = await insertDocument("Old row text.");
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(unmoved);
      if (!doc) throw new Error("missing");
      expect(await readDocumentText(ctx, doc, 4, 7)).toBe("row");
      expect(documentTextLength(doc)).toBe(13);
      expect(documentHasText(doc)).toBe(true);
      expect(await ctx.db.query("projectDocumentTexts").take(1)).toEqual([]);
    });
  });

  test("fails closed when a moved row's pieces are missing", async () => {
    const { t, insertDocument } = await setup();
    const text = "y".repeat(DOCUMENT_TEXT_PIECE_CHARS * 2 + 10);
    const documentId = await insertDocument(text);
    await move(t, documentId, text);
    await t.run(async (ctx) => {
      const middle = await ctx.db.query("projectDocumentTexts")
        .withIndex("by_documentId_and_start", (q) =>
          q.eq("documentId", documentId).eq("start", DOCUMENT_TEXT_PIECE_CHARS))
        .unique();
      if (middle) await ctx.db.delete(middle._id);
    });
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(documentId);
      if (!doc) throw new Error("missing");
      await expect(readDocumentText(ctx, doc)).rejects.toThrow("incomplete");
      // A range inside the first piece still reads.
      expect(await readDocumentText(ctx, doc, 0, 5)).toBe("yyyyy");
    });
  });

  test("rewriting replaces the pieces, and deleting the file deletes them", async () => {
    const { t, insertDocument, writer } = await setup();
    const documentId = await insertDocument("first");
    await move(t, documentId, "z".repeat(DOCUMENT_TEXT_PIECE_CHARS + 1));
    await move(t, documentId, "second text");
    await t.run(async (ctx) => {
      const pieces = await ctx.db.query("projectDocumentTexts")
        .withIndex("by_documentId_and_start", (q) => q.eq("documentId", documentId))
        .take(10);
      expect(pieces.map((piece) => piece.text)).toEqual(["second text"]);
    });
    await writer.mutation(api.documents.deleteDocument, { documentId });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(documentId)).toBeNull();
      expect(await ctx.db.query("projectDocumentTexts").take(1)).toEqual([]);
    });
  });
});
