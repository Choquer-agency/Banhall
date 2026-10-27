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
import { buildChatEvidence, EVIDENCE_LABELS, MAX_CHAT_COMPANY_FILES, type ChatCompanyFile } from "./ai/chatEvidence";
import {
  makeReadDocumentTool,
  makeSearchDocumentsTool,
  newDocumentReadTurn,
  runReadDocument,
  runSearchDocuments,
} from "./ai/chatDocumentTools";
import { COMPANY_FILES_NOTE } from "./lib/companyEvidence";
import { FILE_LABELS_PROMPT_VERSION } from "./lib/fileLabels";

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
    return { writerId, rolelessId, acmeId, otherId, projectId, reportId, historyId, archivedId, theirsId };
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

/** A company file of Acme's with text, added after the setup's. */
async function addAcmeFile(
  s: Setup,
  fileName: string,
  text: string,
  extra: { category?: "previous_pd"; title?: string; staleTitle?: string } = {}
) {
  return await s.t.run(async (ctx) => {
    const facts = await companyFileTextFacts(text);
    const label = (title: string, textHash: string) => ({
      documentType: "report", fiscalYear: null, title, summary: "A summary.", model: "claude-haiku-5-5",
      promptVersion: FILE_LABELS_PROMPT_VERSION, textHash, fileName, labeledAt: 1,
    });
    const id = await ctx.db.insert("companyFiles", {
      clientId: s.acmeId, fileName, fileType: "txt", ...facts, processingStatus: "ready", uploadedBy: s.writerId, createdAt: Date.now(),
      ...(extra.category ? { category: extra.category } : {}),
      ...(extra.title ? { labels: label(extra.title, facts.textHash) } : {}),
      ...(extra.staleTitle ? { labels: label(extra.staleTitle, "an-earlier-text") } : {}),
    });
    await insertCompanyFileTextPieces(ctx, id, text);
    return id;
  });
}

describe("the company files a chat turn lists and searches (review 2)", () => {
  test("listed only for a sender who may read them, oldest first, with a draft's category and a title only from current labels", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.historyId, {
      labels: {
        documentType: "history", fiscalYear: null, title: "Old title", summary: "A summary.", model: "claude-haiku-5-5",
        promptVersion: FILE_LABELS_PROMPT_VERSION, textHash: "an-earlier-text", fileName: "history.txt", labeledAt: 1,
      },
    }));
    const pdId = await addAcmeFile(s, "report-2024.txt", "Acme's 2024 report.", { category: "previous_pd", title: "2024 report" });
    const context = async (userId?: Id<"users">) =>
      (await s.t.query(internal.chatV2.getChatContextV2, {
        reportId: s.reportId,
        agentThreadId: "thread-company",
        ...(userId ? { userId } : {}),
      })).companyFiles;
    expect(await context(s.writerId)).toEqual([
      expect.objectContaining({ companyFileId: s.historyId, fileName: "history.txt", category: "other" }),
      expect.objectContaining({ companyFileId: pdId, fileName: "report-2024.txt", category: "background", title: "2024 report" }),
    ]);
    expect((await context(s.writerId))?.[0]).not.toHaveProperty("title");
    expect(await context()).toBeUndefined();
    expect(await context(s.rolelessId)).toBeUndefined();
    // Read through the chat, a previous-year report of the company is background, not this project's prior year.
    expect(await read(s, pdId, s.writerId)).toMatchObject({ status: "ok", category: "background" });
  });

  test("search reaches only listed files, and none after an archive, a relink or a merge", async () => {
    const s = await setup();
    // Excerpts of Acme's history.txt.
    const historyExcerpts = async () => {
      const found = await s.t.query(internal.chatDocuments.searchForChat, {
        agentThreadId: "thread-company", query: "graphite packing", maxChars: 20_000, userId: s.writerId,
      });
      if (found.status !== "ok") throw new Error(found.status);
      return found.excerpts.filter((excerpt) => excerpt.kind === "company" && excerpt.companyFileId === s.historyId).length;
    };
    expect(await historyExcerpts()).toBe(1);
    await s.t.run(async (ctx) => ctx.db.patch(s.historyId, { archived: true }));
    expect(await historyExcerpts()).toBe(0);
    await s.t.run(async (ctx) => ctx.db.patch(s.historyId, { archived: undefined }));
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { clientId: s.otherId }));
    expect(await historyExcerpts()).toBe(0);
    await s.t.run(async (ctx) => ctx.db.patch(s.projectId, { clientId: s.acmeId }));
    await s.t.run(async (ctx) => ctx.db.patch(s.acmeId, { status: "merged", mergedIntoClientId: s.otherId }));
    expect(await historyExcerpts()).toBe(0);
    await s.t.run(async (ctx) => ctx.db.patch(s.acmeId, { status: "active", mergedIntoClientId: undefined }));
    expect(await historyExcerpts()).toBe(1);
    // 30 newer files push history.txt out of the list: search no longer finds what readDocument could not open.
    for (let index = 0; index < MAX_CHAT_COMPANY_FILES; index += 1) {
      await addAcmeFile(s, `note-${index}.txt`, `Acme note ${index} about valves.`);
    }
    expect(await historyExcerpts()).toBe(0);
  });

  test("a company excerpt is placed by its handle and shown as a company file", async () => {
    const files: ChatCompanyFile[] = [
      { companyFileId: "cf1" as Id<"companyFiles">, fileName: "history.txt", textLength: 900 },
    ];
    const turn = newDocumentReadTurn({ documents: [], transcripts: [], companyFiles: files }, "user-1" as Id<"users">);
    const sent: unknown[] = [];
    const ctx = {
      threadId: "thread-company",
      runQuery: (async (_ref: unknown, args: unknown) => {
        sent.push(args);
        return {
          status: "ok",
          complete: true,
          excerpts: [{ kind: "company", companyFileId: "cf1", fileName: "history.txt", start: 0, text: "Acme has used graphite packing." }],
        };
      }) as never,
    };
    const receipt = await runSearchDocuments(ctx, { query: "graphite" }, { toolCallId: "call-1" }, turn);
    expect(receipt).toContain("C1 part 1");
    expect(String(turn.opened.get("call-1"))).toContain("company file history.txt");
    expect(sent).toEqual([expect.objectContaining({ userId: "user-1" })]);
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
