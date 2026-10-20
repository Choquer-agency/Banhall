/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  CHAT_READ_PART_CHARS,
  chatSearchTerms,
  chatTranscriptSummaries,
  chunkSpans,
  safeRange,
  transcriptTurnLine,
  type ReadDocumentResult,
  type ReadTranscriptResult,
  type SearchDocumentsResult,
} from "./chatDocuments";
import { CHAT_DOCUMENT_TOOLS_KEY } from "./appSettings";

/**
 * Chat parity Phase B (2026-10-20): the reads behind the chat's reading
 * tools, against a real database. Every name and text here is fictional.
 */

const modules = import.meta.glob("./**/*.ts");

// Typed by hand: the module is new, and api.d.ts lists it after codegen.
const readDocument = makeFunctionReference<"query", Record<string, unknown>, ReadDocumentResult>(
  "chatDocuments:readDocumentForChat"
) as unknown as FunctionReference<"query", "internal", {
  agentThreadId: string; documentId: Id<"projectDocuments">; start: number; maxChars: number;
}, ReadDocumentResult>;
const readTranscript = makeFunctionReference("chatDocuments:readTranscriptForChat") as unknown as FunctionReference<
  "query", "internal",
  { agentThreadId: string; transcriptId: Id<"transcripts">; fromIndex: number; maxTurns?: number; maxChars: number },
  ReadTranscriptResult
>;
const search = makeFunctionReference("chatDocuments:searchForChat") as unknown as FunctionReference<
  "query", "internal", { agentThreadId: string; query: string; maxChars: number }, SearchDocumentsResult
>;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "auth-reading-queries", role: "writer" });
    const project = (title: string) =>
      ctx.db.insert("projects", {
        title, clientName: "Client", status: "review", createdBy: userId, ownerId: userId,
        shareToken: `${title}-token`, createdAt: now, updatedAt: now,
      });
    const projectId = await project("Reading");
    const otherProjectId = await project("Other");
    const report = (projectId: Id<"projects">) =>
      ctx.db.insert("reports", {
        projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1,
        generatedAt: now, updatedAt: now, revisionNumber: 0,
      });
    const reportId = await report(projectId);
    const otherReportId = await report(otherProjectId);
    const thread = (agentThreadId: string, projectId: Id<"projects">, reportId: Id<"reports">) =>
      ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId, title: "Chat", createdAt: now });
    await thread("thread-ok", projectId, reportId);
    // A thread whose report belongs to another project reads nothing.
    await thread("thread-mismatch", projectId, otherReportId);
    const file = (projectId: Id<"projects">, fileName: string, content: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "txt", content, source: "upload", uploadedBy: "writer",
        uploaderRole: "writer", category: "other", createdAt: now, ...extra,
      });
    const notesId = await file(
      projectId,
      "étalonnage.txt",
      `${"Intro paragraph about the fictional rig.\n\n".repeat(1_000)}Le contrôle de l'étalonnage du capteur a dérivé.`
    );
    const archivedId = await file(projectId, "archived.txt", "Archived étalonnage text.", { archived: true });
    const otherId = await file(otherProjectId, "other.txt", "Other project étalonnage text.");
    const emptyId = await file(projectId, "scan.pdf", "", { fileType: "pdf", processingStatus: "could_not_read" });

    const transcriptId = await ctx.db.insert("transcripts", {
      projectId, label: "Kickoff", content: "x".repeat(500), position: 0, createdAt: now,
    });
    for (let index = 0; index < 5; index += 1) {
      await ctx.db.insert("transcriptTurns", {
        transcriptId, projectId, parserVersion: "7", index,
        speakerLabel: index % 2 === 0 ? "Sam Lee" : "Dana",
        startMs: index * 60_000, charStart: index * 100, charEnd: index * 100 + 90,
        cleanText: index === 3 ? "The calibration drift came back in March." : `Turn ${index + 1} words.`,
      });
    }
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Sam Lee", role: "interviewer", roleSource: "consultant", confidence: 1, turnCount: 3,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Dana", role: "client", roleSource: "heuristic", confidence: 0.6, turnCount: 2,
    });
    const plainId = await ctx.db.insert("transcripts", {
      projectId, label: "Notes call", content: "y".repeat(CHAT_READ_PART_CHARS + 10), position: 1, createdAt: now,
    });
    const removedId = await ctx.db.insert("transcripts", {
      projectId, label: "Removed", content: "Removed words.", position: 2, createdAt: now, archivedAt: now,
    });
    return { userId, projectId, notesId, archivedId, otherId, emptyId, transcriptId, plainId, removedId };
  });
  return { t, ...ids };
}

describe("readDocumentForChat", () => {
  test("reads a slice of a file of the thread's project", async () => {
    const f = await setup();
    const result = await f.t.query(readDocument, {
      agentThreadId: "thread-ok", documentId: f.notesId, start: 0, maxChars: 100,
    });
    expect(result).toMatchObject({ status: "ok", fileName: "étalonnage.txt", start: 0, end: 100, category: "other" });
    expect(result.status === "ok" && result.text.length).toBe(100);
  });

  test("refuses archived files, other projects' files, files with no text and mismatched threads", async () => {
    const f = await setup();
    const read = (documentId: Id<"projectDocuments">, agentThreadId = "thread-ok") =>
      f.t.query(readDocument, { agentThreadId, documentId, start: 0, maxChars: 100 });
    expect(await read(f.archivedId)).toEqual({ status: "not_found" });
    expect(await read(f.otherId)).toEqual({ status: "not_found" });
    expect(await read(f.emptyId)).toEqual({ status: "no_text", fileName: "scan.pdf" });
    expect(await read(f.notesId, "thread-mismatch")).toEqual({ status: "unavailable" });
    expect(await read(f.notesId, "thread-missing")).toEqual({ status: "unavailable" });
    expect(
      await f.t.query(readDocument, { agentThreadId: "thread-ok", documentId: f.notesId, start: 10_000_000, maxChars: 10 })
    ).toMatchObject({ status: "past_end" });
  });

  test("says off when the admin setting is off", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("appSettings", { key: CHAT_DOCUMENT_TOOLS_KEY, value: "off", updatedAt: Date.now(), updatedBy: f.userId });
    });
    expect(
      await f.t.query(readDocument, { agentThreadId: "thread-ok", documentId: f.notesId, start: 0, maxChars: 10 })
    ).toEqual({ status: "off" });
  });
});

describe("readTranscriptForChat", () => {
  test("pages by speaker turn, with roles and names as written", async () => {
    const f = await setup();
    const first = await f.t.query(readTranscript, {
      agentThreadId: "thread-ok", transcriptId: f.transcriptId, fromIndex: 0, maxTurns: 2, maxChars: 40_000,
    });
    expect(first).toEqual({
      status: "turns",
      label: "Kickoff",
      totalTurns: 5,
      firstIndex: 0,
      lastIndex: 1,
      cutShort: false,
      // Dana's role is a guess under the 0.7 threshold, so it reads as unknown.
      text: "[turn 1, 00:00:00] Interviewer (Sam Lee): Turn 1 words.\n[turn 2, 00:01:00] Role unknown (Dana): Turn 2 words.",
    });
    const tail = await f.t.query(readTranscript, {
      agentThreadId: "thread-ok", transcriptId: f.transcriptId, fromIndex: 3, maxChars: 40_000,
    });
    expect(tail).toMatchObject({ status: "turns", firstIndex: 3, lastIndex: 4 });
    // A character cap smaller than one turn still returns that turn, cut.
    const cut = await f.t.query(readTranscript, {
      agentThreadId: "thread-ok", transcriptId: f.transcriptId, fromIndex: 3, maxChars: 20,
    });
    expect(cut).toMatchObject({ status: "turns", firstIndex: 3, lastIndex: 3, cutShort: true });
    expect(cut.status === "turns" && cut.text.length).toBe(20);
  });

  test("pages a transcript with no turns by characters, and refuses removed ones", async () => {
    const f = await setup();
    const part2 = await f.t.query(readTranscript, {
      agentThreadId: "thread-ok", transcriptId: f.plainId, fromIndex: 1, maxChars: 40_000,
    });
    expect(part2).toMatchObject({ status: "chars", start: CHAT_READ_PART_CHARS, end: CHAT_READ_PART_CHARS + 10 });
    expect(
      await f.t.query(readTranscript, { agentThreadId: "thread-ok", transcriptId: f.removedId, fromIndex: 0, maxChars: 100 })
    ).toEqual({ status: "not_found" });
  });
});

describe("searchForChat", () => {
  test("finds accented words with or without accents, in files and transcripts, never archived or other projects' text", async () => {
    const f = await setup();
    const result = await f.t.query(search, { agentThreadId: "thread-ok", query: "etalonnage capteur", maxChars: 12_000 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const texts = result.excerpts.map((excerpt) => excerpt.text).join("\n");
    expect(texts).toContain("Le contrôle de l'étalonnage du capteur a dérivé.");
    expect(texts).not.toContain("Archived");
    expect(texts).not.toContain("Other project");
    expect(result.excerpts[0]).toMatchObject({ kind: "file", documentId: f.notesId });
    // The excerpt sits past the first part, where the part number comes from.
    expect(result.excerpts[0]!.kind === "file" && result.excerpts[0]!.start).toBeGreaterThan(CHAT_READ_PART_CHARS);

    const turns = await f.t.query(search, { agentThreadId: "thread-ok", query: "calibration drift", maxChars: 12_000 });
    expect(turns.status === "ok" && turns.excerpts[0]).toMatchObject({
      kind: "transcript", transcriptId: f.transcriptId, firstIndex: 0, lastIndex: 4,
    });
  });

  test("returns no_terms for a query with no word to search", async () => {
    const f = await setup();
    expect(await f.t.query(search, { agentThreadId: "thread-ok", query: "a de", maxChars: 100 })).toEqual({ status: "no_terms" });
  });
});

describe("chatTranscriptSummaries", () => {
  test("lists active transcripts in order with turns, size and evidence roles", async () => {
    const f = await setup();
    const result = await f.t.run(async (ctx) =>
      chatTranscriptSummaries(ctx, f.projectId, {
        read: async (fn) => ({ ok: true as const, value: await fn() }),
      })
    );
    expect(result).toEqual({
      complete: true,
      transcripts: [
        {
          transcriptId: f.transcriptId, label: "Kickoff", turnCount: 5, chars: 500,
          speakers: [{ label: "Dana", role: "unknown" }, { label: "Sam Lee", role: "interviewer" }],
        },
        { transcriptId: f.plainId, label: "Notes call", turnCount: 0, chars: CHAT_READ_PART_CHARS + 10, speakers: [] },
      ],
    });
    const refused = await f.t.run(async (ctx) =>
      chatTranscriptSummaries(ctx, f.projectId, { read: async () => ({ ok: false as const }) })
    );
    expect(refused).toEqual({ transcripts: [], complete: false });
  });
});

describe("pure helpers", () => {
  test("search terms keep accented letters, fold them for matching, and drop stop words", () => {
    expect(chatSearchTerms("Le contrôle de l'étalonnage, with the capteur")).toEqual({
      terms: ["controle", "etalonnage", "capteur"],
      index: "contrôle étalonnage capteur controle etalonnage",
    });
  });

  test("chunks carry their offsets and never split a surrogate pair", () => {
    const text = `First paragraph.\n\nSecond paragraph.\n\n${"z".repeat(30)}`;
    const spans = chunkSpans(text, 20);
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual([
      "First paragraph.",
      "Second paragraph.",
      "z".repeat(20),
      "z".repeat(14),
    ].slice(0, spans.length));
    expect(safeRange("a😀b", 0, 2)).toEqual({ start: 0, end: 1 });
    expect(safeRange("a😀b", 2, 4)).toEqual({ start: 1, end: 4 });
  });

  test("a turn line has no line breaks and says when there is no label", () => {
    expect(transcriptTurnLine({ index: 11, startMs: 872_000, speakerLabel: "Dana", cleanText: "Two\nlines" }, "client")).toBe(
      "[turn 12, 00:14:32] Client (Dana): Two lines"
    );
    expect(transcriptTurnLine({ index: 0, cleanText: "Text" }, "unknown")).toBe("[turn 1] No speaker label: Text");
  });
});
