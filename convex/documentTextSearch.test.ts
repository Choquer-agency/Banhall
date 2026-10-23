/// <reference types="vite/client" />
/**
 * 2026-10-22 (fourth), step 2: chat search and research find files through
 * the pieces' search index and, while files are still moving, the old index
 * on `content`. Excerpts and their positions come from the whole text, as
 * before. Every name and text here is fictional. convex-test's search
 * ranking is not production's, so these tests check which files and
 * excerpts come back, not their order.
 */
import { convexTest } from "convex-test";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { SearchDocumentsResult } from "./chatDocuments";
import { searchProjectDocuments, writeDocumentText } from "./lib/documentText";

const modules = import.meta.glob("./**/*.ts");

const search = makeFunctionReference("chatDocuments:searchForChat") as unknown as FunctionReference<
  "query", "internal", { agentThreadId: string; query: string; maxChars: number }, SearchDocumentsResult
>;

const FILES = [
  { fileName: "bench.txt", text: `${"Setup paragraph about the rig.\n\n".repeat(400)}The calibration drift returned after the coating change.\n\nMore notes.` },
  { fileName: "trial.txt", text: "Trial two: calibration drift was within limits after cleaning." },
  { fileName: "unrelated.txt", text: "Budget and schedule notes only." },
];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "auth-text-search", role: "writer" });
    const project = async (title: string) => {
      const projectId = await ctx.db.insert("projects", {
        title, clientName: "Kestrel Instruments", status: "review", createdBy: userId, ownerId: userId,
        shareToken: `${title}-token`, createdAt: now, updatedAt: now,
      });
      const reportId = await ctx.db.insert("reports", {
        projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1,
        generatedAt: now, updatedAt: now, revisionNumber: 0,
      });
      await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: `thread-${title}`, title: "Chat", createdAt: now });
      return projectId;
    };
    const file = async (projectId: Id<"projects">, fileName: string, text: string, moved: boolean, extra: { archived?: boolean } = {}) => {
      const documentId = await ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "txt", content: moved ? "" : text, source: "upload",
        uploadedBy: "writer", uploaderRole: "writer", category: "other", createdAt: now, ...extra,
      });
      if (moved) {
        const doc = await ctx.db.get(documentId);
        if (!doc) throw new Error("missing");
        await ctx.db.patch(documentId, await writeDocumentText(ctx, doc, text));
      }
      return documentId;
    };
    const movedProjectId = await project("moved");
    const legacyProjectId = await project("legacy");
    const mixedProjectId = await project("mixed");
    for (const spec of FILES) {
      await file(movedProjectId, spec.fileName, spec.text, true);
      await file(legacyProjectId, spec.fileName, spec.text, false);
    }
    // Archived files and a piece whose file is gone are never found.
    await file(movedProjectId, "archived.txt", "Archived calibration drift notes.", true, { archived: true });
    await file(legacyProjectId, "archived.txt", "Archived calibration drift notes.", false, { archived: true });
    const goneId = await file(movedProjectId, "gone.txt", "Gone calibration drift notes.", true);
    await ctx.db.delete(goneId);
    // One file mid-move (text in pieces and still on its row), one moved,
    // one not: each comes back once.
    const both = await file(mixedProjectId, "both.txt", "Both: calibration drift.", false);
    const bothDoc = await ctx.db.get(both);
    if (!bothDoc) throw new Error("missing");
    await ctx.db.patch(both, await writeDocumentText(ctx, bothDoc, bothDoc.content ?? ""));
    await file(mixedProjectId, "moved.txt", "Moved: calibration drift.", true);
    await file(mixedProjectId, "unmoved.txt", "Unmoved: calibration drift.", false);
    return { movedProjectId, legacyProjectId, mixedProjectId };
  });
  return { t, ...ids };
}

const excerptsOf = (result: SearchDocumentsResult) => {
  if (result.status !== "ok") throw new Error(`search ${result.status}`);
  return result.excerpts
    .map((excerpt) => (excerpt.kind === "file" ? { file: excerpt.fileName, start: excerpt.start, text: excerpt.text } : excerpt))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};

describe("search over moved files (2026-10-22, fourth, step 2)", () => {
  test("chat search returns the same excerpts at the same positions", async () => {
    const f = await setup();
    const run = (agentThreadId: string) =>
      f.t.query(search, { agentThreadId, query: "calibration drift", maxChars: 6_000 });
    const moved = excerptsOf(await run("thread-moved"));
    const legacy = excerptsOf(await run("thread-legacy"));
    expect(moved).toEqual(legacy);
    expect(moved.map((excerpt) => "file" in excerpt && excerpt.file).sort()).toEqual(["bench.txt", "trial.txt"]);
    const bench = moved.find((excerpt) => "file" in excerpt && excerpt.file === "bench.txt");
    expect(bench && "start" in bench && bench.start).toBeGreaterThan(10_000);
  });

  test("each file comes back once while files are moving", async () => {
    const f = await setup();
    const result = excerptsOf(await f.t.query(search, { agentThreadId: "thread-mixed", query: "calibration drift", maxChars: 6_000 }));
    expect(result.map((excerpt) => "file" in excerpt && excerpt.file).sort()).toEqual(["both.txt", "moved.txt", "unmoved.txt"]);
    const files = await f.t.run(async (ctx) => await searchProjectDocuments(ctx, f.mixedProjectId, "calibration drift", 12));
    expect(files.map((doc) => doc.fileName).sort()).toEqual(["both.txt", "moved.txt", "unmoved.txt"]);
  });

  test("one long file's pieces do not take every file slot", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { authId: "auth-text-search-long", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "long", clientName: "Kestrel", status: "review", createdBy: userId, shareToken: "long-token",
        createdAt: now, updatedAt: now,
      });
      const add = async (fileName: string, text: string) => {
        const documentId = await ctx.db.insert("projectDocuments", {
          projectId, fileName, fileType: "txt", content: "", source: "upload", uploadedBy: "writer", createdAt: now,
        });
        const doc = await ctx.db.get(documentId);
        if (!doc) throw new Error("missing");
        await ctx.db.patch(documentId, await writeDocumentText(ctx, doc, text));
      };
      // 25 pieces, each naming the term.
      await add("long.txt", Array.from({ length: 25 }, () => `${"filler ".repeat(4_500)}calibration drift`).join("\n"));
      for (let index = 0; index < 5; index += 1) await add(`short-${index}.txt`, `Short ${index}: calibration drift.`);
      return projectId;
    });
    const files = await t.run(async (ctx) => await searchProjectDocuments(ctx, projectId, "calibration drift", 4));
    expect(new Set(files.map((doc) => doc._id)).size).toBe(files.length);
    expect(files).toHaveLength(4);
    expect(files.some((doc) => doc.fileName === "long.txt")).toBe(true);
  });
});

// 2026-10-22 (fourth), code review fixes.
describe("search and chat with edge cases of moved files", () => {
  test("a word that falls at a piece edge is still found once content is cleared", async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { authId: "auth-text-edge", role: "writer" });
      const projectId = await ctx.db.insert("projects", {
        title: "edge", clientName: "Kestrel", status: "review", createdBy: userId, shareToken: "edge-token",
        createdAt: now, updatedAt: now,
      });
      const reportId = await ctx.db.insert("reports", {
        projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
      });
      await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "thread-edge", title: "Chat", createdAt: now });
      // A plain cut at 32,000 would leave "calib" and "ration" in two pieces.
      const text = `${"word ".repeat(6_399)}calibration drift reappeared.`;
      // `content: ""`: convex-test cannot search the old index over a row
      // with no `content` field (a real backend leaves such rows out of it;
      // the 2026-10-22 live run searched after the clear pass).
      const documentId = await ctx.db.insert("projectDocuments", {
        projectId, fileName: "edge.txt", fileType: "txt", content: "", source: "upload", uploadedBy: "writer", createdAt: now,
      });
      await ctx.db.patch(documentId, await writeDocumentText(ctx, { _id: documentId, projectId }, text));
      return { projectId };
    });
    const pieces = await t.run(async (ctx) => await ctx.db.query("projectDocumentTexts").take(5));
    expect(pieces.some((piece) => piece.text.includes("calibration"))).toBe(true);
    const result = excerptsOf(await t.query(search, { agentThreadId: "thread-edge", query: "calibration", maxChars: 6_000 }));
    expect(result.map((excerpt) => "file" in excerpt && excerpt.file)).toEqual(["edge.txt"]);
    const files = await t.run(async (ctx) => await searchProjectDocuments(ctx, projectId, "calibration", 12));
    expect(files).toHaveLength(1);
  });

  test("a file with incomplete pieces is left out of search and chat, never the whole call", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      // Break bench.txt: delete its first piece.
      const bench = (await ctx.db.query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", f.movedProjectId))
        .take(20)).find((doc) => doc.fileName === "bench.txt");
      if (!bench) throw new Error("missing");
      const first = await ctx.db.query("projectDocumentTexts")
        .withIndex("by_documentId_and_start", (q) => q.eq("documentId", bench._id).eq("start", 0))
        .unique();
      if (first) await ctx.db.delete(first._id);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await f.t.query(search, { agentThreadId: "thread-moved", query: "calibration drift", maxChars: 6_000 });
      expect(result.status).toBe("ok");
      expect(excerptsOf(result).map((excerpt) => "file" in excerpt && excerpt.file)).toEqual(["trial.txt"]);
      const reportId = await f.t.run(async (ctx) =>
        (await ctx.db.query("agentChatThreads").collect()).find((row) => row.agentThreadId === "thread-moved")!.reportId);
      const context = await f.t.query(internal.chatV2.getChatContextV2, { reportId, agentThreadId: "thread-moved" });
      expect(context.documents.find((doc) => doc.fileName === "bench.txt")?.content).toBe("");
      expect(context.documents.find((doc) => doc.fileName === "trial.txt")?.content).toContain("calibration");
      // Opening or pinning it reads as unavailable, not a failed turn.
      const benchId = context.documents.find((doc) => doc.fileName === "bench.txt")!.documentId!;
      const read = makeFunctionReference("chatDocuments:readDocumentForChat") as unknown as FunctionReference<
        "query", "internal", { agentThreadId: string; documentId: Id<"projectDocuments">; start: number; maxChars: number },
        { status: string }
      >;
      expect(await f.t.query(read, { agentThreadId: "thread-moved", documentId: benchId, start: 0, maxChars: 1_000 }))
        .toEqual({ status: "unavailable" });
    } finally {
      warn.mockRestore();
    }
  });
});
