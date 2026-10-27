/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase C, step 3; decision "2026-10-26", part 1): chat reaches
 * company files only through its search and reading tools, limited to the
 * project's own company now, for a sender who may read company files; it
 * never loads them whole, lists them only by name, and puts the project's
 * own excerpts first.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { chatCompanyFilesFor } from "./chatDocuments";
import { companyFileTextFacts, insertCompanyFileTextPieces } from "./lib/companyFileText";
import { buildChatEvidence, EVIDENCE_LABELS, type ChatCompanyFile } from "./ai/chatEvidence";
import {
  makeReadDocumentTool,
  makeSearchDocumentsTool,
  newDocumentReadTurn,
  runReadDocument,
} from "./ai/chatDocumentTools";
import { COMPANY_FILES_NOTE } from "./lib/companyEvidence";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "chat-company-writer", role: "writer" });
    const rolelessId = await ctx.db.insert("users", { authId: "chat-company-roleless" });
    const client = (name: string) =>
      ctx.db.insert("clients", { name, nameKey: name.toLowerCase(), status: "active", createdBy: writerId, createdAt: now, updatedAt: now });
    const acmeId = await client("Acme");
    const otherId = await client("Borealis");
    const projectId = await ctx.db.insert("projects", {
      title: "Seal", clientName: "Acme", clientId: acmeId, status: "review", createdBy: writerId, ownerId: writerId,
      shareToken: "chat-company-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: JSON.stringify({ type: "doc", content: [] }), version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "thread-company", title: "Chat", createdAt: now });
    await ctx.db.insert("projectDocuments", {
      projectId, fileName: "project-notes.txt", fileType: "txt", content: "The graphite packing held in the project's own trial.",
      source: "upload", uploadedBy: "writer", uploaderRole: "writer", category: "other", createdAt: now,
    });
    const companyFile = async (clientId: Id<"clients">, fileName: string, text: string, extra: { archived?: boolean } = {}) => {
      const id = await ctx.db.insert("companyFiles", {
        clientId, fileName, fileType: "txt", ...(await companyFileTextFacts(text)), processingStatus: "ready",
        ...(extra.archived ? { archived: true } : {}), uploadedBy: writerId, createdAt: Date.now(),
        searchPiecesDue: true, searchPiecesNextAt: 0,
      });
      await insertCompanyFileTextPieces(ctx, id, text);
      return id;
    };
    const historyId = await companyFile(acmeId, "history.txt", "Acme has used graphite packing on cryogenic pumps since 2011.");
    const archivedId = await companyFile(acmeId, "archived.txt", "Archived graphite note.", { archived: true });
    const theirsId = await companyFile(otherId, "theirs.txt", "Borealis graphite valves.");
    return { writerId, rolelessId, acmeId, otherId, projectId, historyId, archivedId, theirsId };
  });
  // Cut the company files' search pieces.
  await t.mutation(internal.searchPieces.sweepDueSearchPieces, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const read = (s: Setup, companyFileId: Id<"companyFiles">, userId?: Id<"users">) =>
  s.t.query(internal.chatDocuments.readCompanyFileForChat, {
    agentThreadId: "thread-company",
    companyFileId,
    ...(userId ? { userId } : {}),
    start: 0,
    maxChars: 10_000,
  });

describe("which company files a chat turn may reach", () => {
  test("the project's company's files, for a sender who may read them, newest first; nothing otherwise", async () => {
    const s = await setup();
    const listed = await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.writerId));
    expect(listed.map((file) => file.fileName)).toEqual(["history.txt"]);
    expect(await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, undefined))).toEqual([]);
    expect(await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.rolelessId))).toEqual([]);
    await s.t.run(async (ctx) => ctx.db.patch(s.acmeId, { status: "merged", mergedIntoClientId: s.otherId }));
    expect(await s.t.run(async (ctx) => chatCompanyFilesFor(ctx, s.projectId, s.writerId))).toEqual([]);
  });

  test("reading a company file: only its own company's, not archived, and only for a sender who may", async () => {
    const s = await setup();
    expect(await read(s, s.historyId, s.writerId)).toMatchObject({ status: "ok", fileName: "history.txt", start: 0 });
    expect(await read(s, s.historyId)).toEqual({ status: "not_found" });
    expect(await read(s, s.historyId, s.rolelessId)).toEqual({ status: "not_found" });
    expect(await read(s, s.archivedId, s.writerId)).toEqual({ status: "not_found" });
    expect(await read(s, s.theirsId, s.writerId)).toEqual({ status: "not_found" });
    // A project relinked to another company no longer reaches the first one's files.
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { clientId: s.otherId }));
    expect(await read(s, s.historyId, s.writerId)).toEqual({ status: "not_found" });
  });

  test("search puts the project's own excerpts first, then the company's, and none without a sender who may", async () => {
    const s = await setup();
    const search = (userId?: Id<"users">) =>
      s.t.query(internal.chatDocuments.searchForChat, {
        agentThreadId: "thread-company",
        query: "graphite packing",
        maxChars: 20_000,
        ...(userId ? { userId } : {}),
      });
    const found = await search(s.writerId);
    if (found.status !== "ok") throw new Error(found.status);
    expect(found.excerpts.map((excerpt) => excerpt.kind)).toEqual(["file", "company"]);
    expect(found.excerpts[1]).toMatchObject({ kind: "company", companyFileId: s.historyId, fileName: "history.txt" });
    const without = await search();
    if (without.status !== "ok") throw new Error(without.status);
    expect(without.excerpts.map((excerpt) => excerpt.kind)).toEqual(["file"]);
  });
});

describe("how the chat sees company files", () => {
  const files: ChatCompanyFile[] = [
    { companyFileId: "cf1" as Id<"companyFiles">, fileName: "history.txt", textLength: 900, title: "Acme history" },
  ];

  test("the COMPANY FILES list names them with handles and the note, never their text; absent without any", () => {
    const withFiles = buildChatEvidence({ reportText: "Report.", analysisText: "Analysis.", companyFiles: files }).head;
    expect(withFiles).toContain(EVIDENCE_LABELS.companyFiles);
    expect(withFiles).toContain("C1 | \"history.txt\"");
    expect(withFiles).toContain(COMPANY_FILES_NOTE);
    const without = buildChatEvidence({ reportText: "Report.", analysisText: "Analysis." }).head;
    expect(without).not.toContain(`${EVIDENCE_LABELS.companyFiles} `);
    const toolsOff = buildChatEvidence({ reportText: "Report.", analysisText: "Analysis.", companyFiles: files, readingToolsOff: true }).head;
    expect(toolsOff).not.toContain("C1 | ");
  });

  test("readDocument opens a company file by its C handle through the company read, and the tools name company files only when listed", async () => {
    const turn = newDocumentReadTurn(
      { documents: [], transcripts: [], companyFiles: files },
      "user-1" as Id<"users">
    );
    const calls: unknown[] = [];
    const ctx = {
      threadId: "thread-company",
      runQuery: (async (_ref: unknown, args: unknown) => {
        calls.push(args);
        return { status: "ok", fileName: "history.txt", totalChars: 900, start: 0, end: 900, text: "Acme history text." };
      }) as never,
    };
    const receipt = await runReadDocument(ctx, { file: "C1" }, { toolCallId: "call-1" }, turn);
    expect(receipt).toContain("Opened company file C1");
    expect(calls).toEqual([expect.objectContaining({ companyFileId: "cf1", userId: "user-1" })]);
    expect(String(turn.opened.get("call-1"))).toContain("company file history.txt");

    const listed = newDocumentReadTurn({ documents: [], transcripts: [], companyFiles: files }, "user-1" as Id<"users">);
    const none = newDocumentReadTurn({ documents: [], transcripts: [] }, "user-1" as Id<"users">);
    expect(makeReadDocumentTool(listed).description).toContain("COMPANY FILES");
    expect(makeReadDocumentTool(none).description).not.toContain("COMPANY FILES");
    expect(makeSearchDocumentsTool(listed).description).toContain("company's files");
    expect(makeSearchDocumentsTool(none).description).not.toContain("company's files");
  });
});
