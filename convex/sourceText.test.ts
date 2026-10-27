/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import {
  getSourceRowWithText,
  sourceRowLength,
  sourceRowSlice,
  sourceRowText,
  SourceTextMismatchError,
  withSourceText,
} from "./lib/sourceText";

const modules = import.meta.glob("./**/*.ts");

/**
 * B1, second part (2026-10-27): reading a draft row's text, whether the row
 * holds its own copy, refers to a stored version, or refers to its
 * transcript. Every name and passage here is fictional.
 */

// A 4-byte character at a piece boundary, so a piece never splits it.
const FILE_TEXT = "Line 242 notes. " + "x".repeat(20) + "\u{1F600}" + " The trial ran at 64 C for six hours.";
const TRANSCRIPT = "Priya Raman: We tuned the seal.\nInterviewer: Why?\nPriya Raman: It leaked at 4 bar.";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "source-text", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Quillmere", status: "draft", createdBy: userId, shareToken: "st", createdAt: 1, updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", { projectId, status: "completed", startedAt: 1 });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId, content: TRANSCRIPT, contentHash: await sha256(TRANSCRIPT), label: "Interview", createdAt: 1,
    });
    // A stored version in three pieces; the second starts after the emoji.
    const cut = FILE_TEXT.indexOf("\u{1F600}") + 2;
    const versionId = await ctx.db.insert("sourceTextVersions", {
      projectId, textHash: await sha256(FILE_TEXT), textLength: FILE_TEXT.length,
      textBytes: new TextEncoder().encode(FILE_TEXT).byteLength, createdAt: 1,
    });
    for (const [start, text] of [[0, FILE_TEXT.slice(0, 10)], [10, FILE_TEXT.slice(10, cut)], [cut, FILE_TEXT.slice(cut)]] as const) {
      await ctx.db.insert("sourceTextVersionPieces", { versionId, projectId, start, text });
    }
    const base = { generationId, projectId, truncated: false, capturedAt: 1 } as const;
    const oldRow = await ctx.db.insert("generationSources", {
      ...base, kind: "project_document", label: "other:old.txt", content: FILE_TEXT, contentHash: await sha256(FILE_TEXT), originalLength: FILE_TEXT.length,
    });
    const versionRow = await ctx.db.insert("generationSources", {
      ...base, kind: "project_document", label: "other:new.txt", textVersionId: versionId, textLength: FILE_TEXT.length,
      contentHash: await sha256(FILE_TEXT), originalLength: FILE_TEXT.length,
    });
    const transcriptRow = await ctx.db.insert("generationSources", {
      ...base, kind: "transcript", transcriptId, label: "Interview", textLength: TRANSCRIPT.length,
      contentHash: await sha256(TRANSCRIPT), originalLength: TRANSCRIPT.length,
    });
    const cutTranscriptRow = await ctx.db.insert("generationSources", {
      ...base, kind: "transcript", transcriptId, label: "Interview", textLength: 31, truncated: true,
      contentHash: await sha256(TRANSCRIPT.slice(0, 31)), originalLength: TRANSCRIPT.length,
    });
    return { projectId, generationId, transcriptId, versionId, oldRow, versionRow, transcriptRow, cutTranscriptRow };
  });
  const read = (id: Id<"generationSources">) => t.run(async (ctx) => sourceRowText(ctx, (await ctx.db.get(id))!));
  return { t, ...ids, read };
}

describe("sourceRowText (B1, second part)", () => {
  it("reads an old row's own copy, a version's pieces, and a transcript up to what the row read", async () => {
    const s = await setup();
    expect(await s.read(s.oldRow)).toBe(FILE_TEXT);
    expect(await s.read(s.versionRow)).toBe(FILE_TEXT);
    expect(await s.read(s.transcriptRow)).toBe(TRANSCRIPT);
    expect(await s.read(s.cutTranscriptRow)).toBe(TRANSCRIPT.slice(0, 31));
  });

  it("keeps reading a transcript after it is archived", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.transcriptId, { archivedAt: 5 }));
    expect(await s.read(s.transcriptRow)).toBe(TRANSCRIPT);
  });

  it("returns rows in the old shape, the new fields left out", async () => {
    const s = await setup();
    const [oldShape, newShape] = await s.t.run(async (ctx) => [
      await withSourceText(ctx, (await ctx.db.get(s.oldRow))!),
      await getSourceRowWithText(ctx, s.versionRow),
    ]);
    expect(Object.keys(newShape!).sort()).toEqual(Object.keys(oldShape).sort());
    expect(newShape!.content).toBe(oldShape.content);
    expect(newShape).not.toHaveProperty("textVersionId");
    expect(newShape).not.toHaveProperty("textLength");
  });

  it("reads a slice from only the pieces it falls in, the same bytes as the whole text", async () => {
    const s = await setup();
    const at = FILE_TEXT.indexOf("The trial");
    for (const [start, end] of [[0, 5], [8, 30], [at, at + 20], [at, FILE_TEXT.length + 10], [5, 5]] as const) {
      const [oldSlice, newSlice] = await s.t.run(async (ctx) => [
        await sourceRowSlice(ctx, (await ctx.db.get(s.oldRow))!, start, end),
        await sourceRowSlice(ctx, (await ctx.db.get(s.versionRow))!, start, end),
      ]);
      expect(newSlice).toBe(oldSlice);
      expect(newSlice).toBe(FILE_TEXT.slice(start, end));
    }
  });

  it("says how much a row read without reading its text", async () => {
    const s = await setup();
    const lengths = await s.t.run(async (ctx) =>
      Promise.all([s.oldRow, s.versionRow, s.cutTranscriptRow].map(async (id) => sourceRowLength((await ctx.db.get(id))!)))
    );
    expect(lengths).toEqual([FILE_TEXT.length, FILE_TEXT.length, 31]);
  });

  it("refuses by name a version that does not match, a missing piece, and a changed or shorter transcript", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.versionRow, { contentHash: "other" }));
    await expect(s.read(s.versionRow)).rejects.toThrow(SourceTextMismatchError);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.versionRow, { contentHash: await sha256(FILE_TEXT) });
      const [first] = await ctx.db.query("sourceTextVersionPieces").withIndex("by_versionId_and_start", (q) => q.eq("versionId", s.versionId)).take(1);
      await ctx.db.delete(first!._id);
    });
    await expect(s.read(s.versionRow)).rejects.toThrow(/a piece of its text is missing/);
    await s.t.run((ctx) => ctx.db.patch(s.transcriptId, { contentHash: "changed" }));
    await expect(s.read(s.transcriptRow)).rejects.toThrow(/does not match the row/);
    await s.t.run((ctx) => ctx.db.patch(s.transcriptId, { content: "Short." }));
    await expect(s.read(s.cutTranscriptRow)).rejects.toThrow(/shorter than it read/);
  });

  it("refuses a row that holds no text and refers to none", async () => {
    const s = await setup();
    const id = await s.t.run(async (ctx) =>
      ctx.db.insert("generationSources", {
        generationId: s.generationId, projectId: s.projectId, kind: "project_document", label: "other:none.txt",
        contentHash: "h", truncated: false, originalLength: 1, capturedAt: 1,
      })
    );
    await expect(s.read(id)).rejects.toThrow(/holds no text and refers to none/);
  });
});
