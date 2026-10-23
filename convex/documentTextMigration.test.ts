/// <reference types="vite/client" />
/**
 * 2026-10-22 (fourth), steps 4 and 5: the copy pass moves old files' text to
 * pieces and keeps `content`; the clear pass clears it only when the pieces
 * read back exactly. Every name and text here is fictional.
 */
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { CAP_TRUNCATION_MARKER } from "../shared/documentStatus";
import { readDocumentText } from "./lib/documentText";

const modules = import.meta.glob("./**/*.ts");

type PageArgs = { cursor?: string | null; pageSize?: number; dryRun?: boolean };
const backfill = makeFunctionReference("documentTextMigration:backfillDocumentTexts") as unknown as FunctionReference<
  "mutation", "internal", PageArgs,
  { scanned: number; moved: number; clearedAtOnce: number; overCap: number; isDone: boolean; continueCursor: string }
>;
const clear = makeFunctionReference("documentTextMigration:clearMovedDocumentContent") as unknown as FunctionReference<
  "mutation", "internal", PageArgs,
  { scanned: number; cleared: number; mismatched: number; mismatchedIds: string[]; isDone: boolean; continueCursor: string }
>;
const status = makeFunctionReference("documentTextMigration:documentTextMoveStatus") as unknown as FunctionReference<
  "query", "internal", { cursor?: string | null },
  { scanned: number; unmoved: number; movedKeepingContent: number; movedAndCleared: number; isDone: boolean; continueCursor: string }
>;

async function setup(options: { transactionLimits?: boolean } = {}) {
  vi.useFakeTimers();
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "auth-text-migration", role: "writer" });
    const project = (title: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("projects", {
        title, clientName: "Kestrel", status: "draft", createdBy: userId, shareToken: `${title}-token`,
        createdAt: now, updatedAt: now, ...extra,
      });
    const projectId = await project("Live");
    const deletingId = await project("Deleting", { deletionStartedAt: now });
    const old = (projectId: Id<"projects">, fileName: string, content: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "txt", content, source: "upload", uploadedBy: "writer", createdAt: now, ...extra,
      });
    return {
      projectId,
      longId: await old(projectId, "long.txt", `Long notes. ${"word ".repeat(30_000)}`, { processingStatus: "ready" }),
      // No stored status, and a truncation marker the status comes from.
      truncatedId: await old(projectId, "cut.txt", `Cut notes.\n${CAP_TRUNCATION_MARKER}`),
      blankId: await old(projectId, "blank.txt", "", { processingStatus: "could_not_read" }),
      deletingDocId: await old(deletingId, "deleting.txt", "Deleting project notes."),
    };
  });
  return { t, ...ids };
}

const run = async (t: ReturnType<typeof convexTest>) => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
};

describe("moving old files' text (2026-10-22, fourth, steps 4 and 5)", () => {
  test("the copy pass moves text to pieces, keeps content, fills a missing status, and runs twice safely", async () => {
    const f = await setup();
    const texts = await f.t.run(async (ctx) => ({
      long: (await ctx.db.get(f.longId))!.content,
      truncated: (await ctx.db.get(f.truncatedId))!.content,
    }));
    // A dry run counts and writes nothing.
    expect(await f.t.mutation(backfill, { dryRun: true })).toMatchObject({ moved: 3, isDone: true });
    expect(await f.t.run(async (ctx) => await ctx.db.query("projectDocumentTexts").take(1))).toEqual([]);

    expect(await f.t.mutation(backfill, {})).toMatchObject({ moved: 3 });
    await run(f.t);
    const rows = await f.t.run(async (ctx) => ({
      long: (await ctx.db.get(f.longId))!,
      truncated: (await ctx.db.get(f.truncatedId))!,
      blank: (await ctx.db.get(f.blankId))!,
      deleting: (await ctx.db.get(f.deletingDocId))!,
    }));
    expect(rows.long).toMatchObject({ content: texts.long, textLength: texts.long!.length, hasText: true });
    expect(rows.long.textMovedAt).toBeDefined();
    expect(rows.truncated).toMatchObject({ processingStatus: "ready_truncated", content: texts.truncated });
    expect(rows.blank).toMatchObject({ textLength: 0, hasText: false });
    // A project being deleted is left alone.
    expect(rows.deleting.textMovedAt).toBeUndefined();
    expect(await f.t.run(async (ctx) => await readDocumentText(ctx, rows.long))).toBe(texts.long);

    // A second run moves nothing.
    expect(await f.t.mutation(backfill, {})).toMatchObject({ moved: 0 });
    expect(await f.t.query(status, {})).toMatchObject({ unmoved: 1, movedKeepingContent: 3, movedAndCleared: 0 });
    vi.useRealTimers();
  });

  test("the clear pass clears content only where the pieces read back exactly", async () => {
    const f = await setup();
    await f.t.mutation(backfill, {});
    await run(f.t);
    const before = await f.t.run(async (ctx) => (await ctx.db.get(f.longId))!.content);
    // Tamper with one file's piece: its content must stay.
    await f.t.run(async (ctx) => {
      const piece = await ctx.db.query("projectDocumentTexts")
        .withIndex("by_documentId_and_start", (q) => q.eq("documentId", f.truncatedId))
        .first();
      // One character changed inside the text.
      if (piece) await ctx.db.patch(piece._id, { text: `X${piece.text.slice(1)}` });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await f.t.mutation(clear, { dryRun: true })).toMatchObject({
      cleared: 2,
      mismatched: 1,
      mismatchedIds: [f.truncatedId],
    });
    expect(await f.t.run(async (ctx) => (await ctx.db.get(f.longId))!.content)).toBe(before);
    expect(await f.t.mutation(clear, {})).toMatchObject({ cleared: 2, mismatched: 1 });
    await run(f.t);
    warn.mockRestore();
    const rows = await f.t.run(async (ctx) => ({
      long: (await ctx.db.get(f.longId))!,
      truncated: (await ctx.db.get(f.truncatedId))!,
    }));
    expect(rows.long.content).toBeUndefined();
    expect(rows.truncated.content).toBeDefined();
    // Readers still give the same text from the pieces.
    expect(await f.t.run(async (ctx) => await readDocumentText(ctx, rows.long))).toBe(before);
    expect(await f.t.query(status, {})).toMatchObject({ unmoved: 1, movedKeepingContent: 1, movedAndCleared: 2 });
    vi.useRealTimers();
  });

  test("each page stays within the read limit, and the next page is scheduled", async () => {
    const f = await setup({ transactionLimits: true });
    await f.t.run(async (ctx) => {
      for (let index = 0; index < 8; index += 1) {
        await ctx.db.insert("projectDocuments", {
          projectId: f.projectId, fileName: `big-${index}.txt`, fileType: "txt", content: "z".repeat(900_000),
          source: "upload", uploadedBy: "writer", processingStatus: "ready", createdAt: Date.now(),
        });
      }
    });
    const first = await f.t.mutation(backfill, {});
    expect(first.isDone).toBe(false);
    await run(f.t);
    expect(await f.t.query(status, {})).toMatchObject({ unmoved: 1 });
    vi.useRealTimers();
  });

  test("a row near the 1 MiB limit has its text cleared with the copy, since it cannot also take the facts", async () => {
    const f = await setup();
    // About 1.044 MB of UTF-8 in 348,000 characters: with its facts the row
    // would pass the 1,048,576-byte limit.
    const wide = "語".repeat(348_000);
    const nearLimitId = await f.t.run(async (ctx) => await ctx.db.insert("projectDocuments", {
      projectId: f.projectId, fileName: "wide.txt", fileType: "txt", content: wide,
      source: "upload", uploadedBy: "writer", processingStatus: "ready", createdAt: Date.now(),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await f.t.mutation(backfill, {})).toMatchObject({ clearedAtOnce: 1 });
    await run(f.t);
    warn.mockRestore();
    const row = await f.t.run(async (ctx) => (await ctx.db.get(nearLimitId))!);
    expect(row.content).toBeUndefined();
    expect(row.textLength).toBe(wide.length);
    expect(await f.t.run(async (ctx) => await readDocumentText(ctx, row))).toBe(wide);
    vi.useRealTimers();
  });

  test("an older row longer than new uploads may be is still moved, and a dry run counts it", async () => {
    const f = await setup();
    // 1,040,000 characters: over the 1,000,000 cap on new text, within the
    // old row limit.
    const long = "a ".repeat(520_000);
    const longId = await f.t.run(async (ctx) => await ctx.db.insert("projectDocuments", {
      projectId: f.projectId, fileName: "very-long.txt", fileType: "txt", content: long,
      source: "upload", uploadedBy: "writer", processingStatus: "ready", createdAt: Date.now(),
    }));
    expect(await f.t.mutation(backfill, { dryRun: true })).toMatchObject({ overCap: 1 });
    expect(await f.t.mutation(backfill, {})).toMatchObject({ overCap: 1 });
    await run(f.t);
    const row = await f.t.run(async (ctx) => (await ctx.db.get(longId))!);
    expect(row.textLength).toBe(long.length);
    expect(await f.t.run(async (ctx) => await readDocumentText(ctx, row))).toBe(long);
    vi.useRealTimers();
  });
});
