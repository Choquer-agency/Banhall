/// <reference types="vite/client" />
/**
 * 2026-11-18 (owner answer 3, "a company holds all its files"): no cap on
 * the files a company holds. The company page lists them a page at a time
 * and finds any by name; a merge moves every file, the first 100 at once
 * and the rest in scheduled steps, and a draft of the kept company's
 * projects waits until they have all moved. Every name here is fictional.
 */
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { COMPANY_FILE_PAGE_SIZE, COMPANY_FILES_MOVING_MESSAGE } from "../shared/companyFileMoves";
import { MERGE_COMPANY_FILE_COUNT_SHOWN, MERGE_COMPANY_FILES_PER_STEP } from "./clients";
import { COMPANY_FILE_LIST_LIMIT } from "./companyFiles";
import { companyFilesMovingInto } from "./lib/clients";
import { insertDocumentWithText } from "./lib/documentText";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup(options: { transactionLimits?: boolean } = {}) {
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "nc-writer", role: "writer", email: "wendy@firm.test", name: "Wendy" });
    const managerId = await ctx.db.insert("users", { authId: "nc-manager", role: "manager", email: "mina@firm.test" });
    await ctx.db.insert("users", { authId: "nc-roleless" });
    const company = async (name: string) => {
      const key = dashboardCompanyKey(name);
      const clientId = await ctx.db.insert("clients", { name, nameKey: key, status: "active", createdBy: managerId, createdAt: now, updatedAt: now });
      await ctx.db.insert("dashboardCompanies", { companyKey: key, clientName: name, projectCount: 1, updatedAt: now });
      const projectId = await ctx.db.insert("projects", {
        title: `${name} seal`,
        clientName: name,
        clientId,
        dashboardCompanyKey: key,
        interviewer: "Ivy Interviewer",
        interviewees: ["Quentin Quill"],
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: `${key}-token`,
        createdAt: now,
        updatedAt: now,
      });
      return { clientId, projectId };
    };
    return { writerId, managerId, acme: await company("Acme"), borealis: await company("Borealis"), cedar: await company("Cedar") };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "nc-writer" }),
    manager: t.withIdentity({ subject: "nc-manager" }),
    roleless: t.withIdentity({ subject: "nc-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

let clock = 0;

/** `count` company files on a company, oldest first, in transactions of 500. */
async function insertFiles(
  s: Setup,
  clientId: Id<"clients">,
  count: number,
  options: { prefix?: string; archived?: boolean; hasText?: boolean } = {}
): Promise<Id<"companyFiles">[]> {
  const ids: Id<"companyFiles">[] = [];
  for (let start = 0; start < count; start += 500) {
    ids.push(
      ...(await s.t.run(async (ctx) => {
        const made: Id<"companyFiles">[] = [];
        for (let i = start; i < Math.min(count, start + 500); i++) {
          made.push(
            await ctx.db.insert("companyFiles", {
              clientId,
              fileName: `${options.prefix ?? "file"} ${i}.txt`,
              fileType: "txt",
              textLength: 0,
              hasText: options.hasText ?? false,
              textHash: "empty",
              textPreview: "",
              wordCount: 0,
              processingStatus: "could_not_read",
              uploadedBy: s.writerId,
              createdAt: ++clock,
              ...(options.archived ? { archived: true } : {}),
            })
          );
        }
        return made;
      }))
    );
  }
  return ids;
}

/** Every page of a company's list, asking for `ask` files a page. */
async function allPages(s: Setup, clientId: Id<"clients">, ask: number, archived?: boolean) {
  const pages: { _id: Id<"companyFiles">; createdAt: number }[][] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: FunctionReturnType<typeof api.companyFiles.listCompanyFilesPage> = await s.writer.query(api.companyFiles.listCompanyFilesPage, {
      clientId,
      ...(archived ? { archived } : {}),
      paginationOpts: { numItems: ask, cursor },
    });
    pages.push(result.page);
    if (result.isDone) return pages;
    cursor = result.continueCursor;
  }
}

async function filesOn(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query("companyFiles").withIndex("by_clientId_and_archived", (q) => q.eq("clientId", clientId)).collect()).length
  );
}

async function eventCount(s: Setup, clientId: Id<"clients">, action: "merge_in" | "merge_out") {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query("companyFileEvents").withIndex("by_clientId_and_at", (q) => q.eq("clientId", clientId)).collect()).filter(
      (event) => event.action === action
    ).length
  );
}

async function client(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) => ctx.db.get(clientId));
}

describe("the company page lists every file, a page at a time", () => {
  test("1,200 files: pages of at most 100 whatever is asked, newest first, none missed or repeated", async () => {
    const s = await setup({ transactionLimits: true });
    const made = await insertFiles(s, s.acme.clientId, 1_200);
    const pages = await allPages(s, s.acme.clientId, 1_000);
    expect(pages).toHaveLength(12);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(COMPANY_FILE_PAGE_SIZE);
    const listed = pages.flat();
    expect(listed.map((file) => file._id)).toEqual([...made].reverse());
    expect(new Set(listed.map((file) => file._id)).size).toBe(1_200);
  });

  test.each([0, 1, 100, 101])("%i files list whole", async (count) => {
    const s = await setup();
    const made = await insertFiles(s, s.acme.clientId, count);
    const pages = await allPages(s, s.acme.clientId, COMPANY_FILE_PAGE_SIZE);
    expect(pages.flat().map((file) => file._id)).toEqual([...made].reverse());
    expect(pages).toHaveLength(Math.max(1, Math.ceil(count / COMPANY_FILE_PAGE_SIZE)));
  });

  test("the archived list pages on its own, and neither list shows the other's files", async () => {
    const s = await setup();
    const active = await insertFiles(s, s.acme.clientId, 130, { prefix: "active" });
    const archived = await insertFiles(s, s.acme.clientId, 150, { prefix: "archived", archived: true });
    const activePages = await allPages(s, s.acme.clientId, COMPANY_FILE_PAGE_SIZE);
    const archivedPages = await allPages(s, s.acme.clientId, COMPANY_FILE_PAGE_SIZE, true);
    expect(activePages.flat().map((file) => file._id)).toEqual([...active].reverse());
    expect(archivedPages.flat().map((file) => file._id)).toEqual([...archived].reverse());
    expect(archivedPages[0]!.every((file) => (file as { archived?: boolean }).archived === true)).toBe(true);
  });

  test("a file added while pages are loaded comes first on the first page, and a removed one leaves", async () => {
    const s = await setup();
    await insertFiles(s, s.acme.clientId, 150);
    const first = await s.writer.query(api.companyFiles.listCompanyFilesPage, {
      clientId: s.acme.clientId,
      paginationOpts: { numItems: COMPANY_FILE_PAGE_SIZE, cursor: null },
    });
    const added = await s.writer.mutation(api.companyFiles.addCompanyFile, {
      clientId: s.acme.clientId,
      fileName: "late scoping notes.txt",
      fileType: "txt",
      content: "Scoping notes for the seal trials.",
    });
    const again = await s.writer.query(api.companyFiles.listCompanyFilesPage, {
      clientId: s.acme.clientId,
      paginationOpts: { numItems: COMPANY_FILE_PAGE_SIZE, cursor: null },
    });
    expect(again.page[0]).toMatchObject({ _id: added, fileName: "late scoping notes.txt", addedBy: "Wendy" });
    expect(again.page.slice(1).map((file) => file._id)).toEqual(first.page.slice(0, COMPANY_FILE_PAGE_SIZE - 1).map((file) => file._id));
    await s.manager.mutation(api.companyFiles.removeCompanyFile, { companyFileId: added });
    const after = await s.writer.query(api.companyFiles.listCompanyFilesPage, {
      clientId: s.acme.clientId,
      paginationOpts: { numItems: COMPANY_FILE_PAGE_SIZE, cursor: null },
    });
    expect(after.page.map((file) => file._id)).toEqual(first.page.map((file) => file._id));
  });

  test("a viewer who may not read company files is refused, as for the old list", async () => {
    const s = await setup();
    const args = { clientId: s.acme.clientId, paginationOpts: { numItems: 10, cursor: null } };
    await expect(s.roleless.query(api.companyFiles.listCompanyFilesPage, args)).rejects.toThrow();
    await expect(s.roleless.query(api.companyFiles.searchCompanyFiles, { clientId: s.acme.clientId, search: "file" })).rejects.toThrow();
  });

  test("the old list is unchanged: the newest 500 and truncated past them", async () => {
    const s = await setup();
    const made = await insertFiles(s, s.acme.clientId, COMPANY_FILE_LIST_LIMIT + 1);
    const listed = await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acme.clientId });
    expect(listed.truncated).toBe(true);
    expect(listed.files.map((file) => file._id)).toEqual([...made].reverse().slice(0, COMPANY_FILE_LIST_LIMIT));
  });
});

describe("finding a file by name among all of a company's files", () => {
  test("finds an old file past the loaded pages, active or archived, on this company only", async () => {
    const s = await setup();
    const [oldReport] = await insertFiles(s, s.acme.clientId, 1, { prefix: "Cryogenic gasket 2016" });
    const [oldArchived] = await insertFiles(s, s.acme.clientId, 1, { prefix: "Cryogenic gasket draft", archived: true });
    await insertFiles(s, s.acme.clientId, 250, { prefix: "notes" });
    await insertFiles(s, s.borealis.clientId, 1, { prefix: "Cryogenic gasket Borealis" });
    const firstPage = await s.writer.query(api.companyFiles.listCompanyFilesPage, {
      clientId: s.acme.clientId,
      paginationOpts: { numItems: COMPANY_FILE_PAGE_SIZE, cursor: null },
    });
    expect(firstPage.page.some((file) => file._id === oldReport)).toBe(false);
    const found = await s.writer.query(api.companyFiles.searchCompanyFiles, { clientId: s.acme.clientId, search: "cryogenic" });
    expect(new Set(found.files.map((file) => file._id))).toEqual(new Set([oldReport, oldArchived]));
    expect(found.files.find((file) => file._id === oldArchived)?.archived).toBe(true);
  });

  test("returns at most 50, and nothing for an empty search", async () => {
    const s = await setup();
    await insertFiles(s, s.acme.clientId, 80, { prefix: "gasket" });
    expect((await s.writer.query(api.companyFiles.searchCompanyFiles, { clientId: s.acme.clientId, search: "gasket" })).files).toHaveLength(50);
    expect((await s.writer.query(api.companyFiles.searchCompanyFiles, { clientId: s.acme.clientId, search: "   " })).files).toEqual([]);
  });
});

describe("a merge moves every file, in steps", () => {
  const merge = (s: Setup, keepKey: string, mergeKeys: string[]) =>
    s.manager.mutation(api.clients.mergeClients, { keepKey, mergeKeys });
  const preview = (s: Setup, keepKey: string, mergeKeys: string[]) =>
    s.manager.query(api.clients.previewClientMerge, { keepKey, mergeKeys });

  test("no files: nothing to move, no mark, no step", async () => {
    const s = await setup();
    expect(await preview(s, "acme", ["borealis"])).toMatchObject({ companyFileCount: 0, moreCompanyFiles: false, tooManyCompanyFiles: false });
    await merge(s, "acme", ["borealis"]);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  test("500 files: the preview counts them, the first 100 move at once, the rest in steps, then the mark clears", async () => {
    const s = await setup();
    await insertFiles(s, s.borealis.clientId, 500, { hasText: true });
    expect(await preview(s, "acme", ["borealis"])).toMatchObject({ companyFileCount: 500, moreCompanyFiles: false, tooManyCompanyFiles: false });
    await merge(s, "acme", ["borealis"]);
    expect(await filesOn(s, s.acme.clientId)).toBe(MERGE_COMPANY_FILES_PER_STEP);
    expect(await filesOn(s, s.borealis.clientId)).toBe(500 - MERGE_COMPANY_FILES_PER_STEP);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBe(s.acme.clientId);
    expect(await s.t.run((ctx) => companyFilesMovingInto(ctx, s.acme.clientId))).toBe(true);

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await filesOn(s, s.acme.clientId)).toBe(500);
    expect(await filesOn(s, s.borealis.clientId)).toBe(0);
    expect(await eventCount(s, s.acme.clientId, "merge_in")).toBe(500);
    expect(await eventCount(s, s.borealis.clientId, "merge_out")).toBe(500);
    const due = await s.t.run(async (ctx) =>
      (await ctx.db.query("companyFiles").withIndex("by_clientId_and_archived", (q) => q.eq("clientId", s.acme.clientId)).collect()).every(
        (file) => file.searchPiecesDue === true && file.searchPiecesNextAt === 0
      )
    );
    expect(due).toBe(true);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBeUndefined();
    expect(await s.t.run((ctx) => companyFilesMovingInto(ctx, s.acme.clientId))).toBe(false);
  });

  test("501 files: the preview says more than 500 and no longer refuses", async () => {
    const s = await setup();
    await insertFiles(s, s.borealis.clientId, MERGE_COMPANY_FILE_COUNT_SHOWN + 1);
    expect(await preview(s, "acme", ["borealis"])).toMatchObject({
      companyFileCount: MERGE_COMPANY_FILE_COUNT_SHOWN,
      moreCompanyFiles: true,
      tooManyCompanyFiles: false,
    });
    await merge(s, "acme", ["borealis"]);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await filesOn(s, s.acme.clientId)).toBe(501);
  });

  test("3,000 files, archived ones too, within Convex's limits in every step", async () => {
    const s = await setup({ transactionLimits: true });
    await insertFiles(s, s.borealis.clientId, 2_500, { hasText: true });
    await insertFiles(s, s.borealis.clientId, 500, { archived: true, prefix: "archived" });
    await merge(s, "acme", ["borealis"]);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await filesOn(s, s.acme.clientId)).toBe(3_000);
    expect(await filesOn(s, s.borealis.clientId)).toBe(0);
    expect(await eventCount(s, s.acme.clientId, "merge_in")).toBe(3_000);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBeUndefined();
  });

  test("two merged companies in one merge each move all their files", async () => {
    const s = await setup();
    await insertFiles(s, s.borealis.clientId, 180, { prefix: "borealis" });
    await insertFiles(s, s.cedar.clientId, 140, { prefix: "cedar" });
    await merge(s, "acme", ["borealis", "cedar"]);
    expect(await filesOn(s, s.acme.clientId)).toBe(MERGE_COMPANY_FILES_PER_STEP);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBe(s.acme.clientId);
    expect((await client(s, s.cedar.clientId))?.companyFilesMovingTo).toBe(s.acme.clientId);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await filesOn(s, s.acme.clientId)).toBe(320);
    expect(await eventCount(s, s.borealis.clientId, "merge_out")).toBe(180);
    expect(await eventCount(s, s.cedar.clientId, "merge_out")).toBe(140);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBeUndefined();
    expect((await client(s, s.cedar.clientId))?.companyFilesMovingTo).toBeUndefined();
  });

  test("the kept company merged again while files still move: they all land in the final company", async () => {
    const s = await setup();
    await insertFiles(s, s.borealis.clientId, 250, { prefix: "borealis" });
    await insertFiles(s, s.acme.clientId, 30, { prefix: "acme" });
    await merge(s, "acme", ["borealis"]);
    expect(await filesOn(s, s.borealis.clientId)).toBe(150);
    // Acme goes into Cedar before Borealis's steps run.
    await merge(s, "cedar", ["acme"]);
    expect((await client(s, s.borealis.clientId))?.companyFilesMovingTo).toBe(s.cedar.clientId);
    expect(await s.t.run((ctx) => companyFilesMovingInto(ctx, s.cedar.clientId))).toBe(true);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await filesOn(s, s.cedar.clientId)).toBe(280);
    expect(await filesOn(s, s.acme.clientId)).toBe(0);
    expect(await filesOn(s, s.borealis.clientId)).toBe(0);
    for (const id of [s.acme.clientId, s.borealis.clientId]) expect((await client(s, id))?.companyFilesMovingTo).toBeUndefined();
    expect(await s.t.run((ctx) => companyFilesMovingInto(ctx, s.cedar.clientId))).toBe(false);
  });

  test("a step run twice moves no file twice, and a step after the move does nothing", async () => {
    const s = await setup();
    await insertFiles(s, s.borealis.clientId, 230);
    await merge(s, "acme", ["borealis"]);
    const args = { fromClientId: s.borealis.clientId, userId: s.managerId };
    expect(await s.t.mutation(internal.clients.moveMergedCompanyFiles, args)).toEqual({ moved: 100, done: false });
    expect(await s.t.mutation(internal.clients.moveMergedCompanyFiles, args)).toEqual({ moved: 30, done: true });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.mutation(internal.clients.moveMergedCompanyFiles, args)).toEqual({ moved: 0, done: true });
    expect(await filesOn(s, s.acme.clientId)).toBe(230);
    expect(await eventCount(s, s.acme.clientId, "merge_in")).toBe(230);
    expect(await eventCount(s, s.borealis.clientId, "merge_out")).toBe(230);
  });

  test("the merged company's website file moves and is archived in the merge itself, even past the first 100", async () => {
    const s = await setup();
    const [website] = await insertFiles(s, s.borealis.clientId, 1, { prefix: "Website: borealis.example" });
    await insertFiles(s, s.borealis.clientId, 200);
    await s.t.run((ctx) => ctx.db.patch(s.borealis.clientId, { websiteFileId: website }));
    await merge(s, "acme", ["borealis"]);
    expect(await s.t.run((ctx) => ctx.db.get(website!))).toMatchObject({ clientId: s.acme.clientId, archived: true });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await filesOn(s, s.acme.clientId)).toBe(201);
    expect(await eventCount(s, s.acme.clientId, "merge_in")).toBe(201);
  });

  test("an archived website file moves and stays archived without a second archive event", async () => {
    const s = await setup();
    const [website] = await insertFiles(s, s.borealis.clientId, 1, { prefix: "Website: borealis.example", archived: true });
    await s.t.run((ctx) => ctx.db.patch(s.borealis.clientId, { websiteFileId: website }));
    await merge(s, "acme", ["borealis"]);
    expect(await s.t.run((ctx) => ctx.db.get(website!))).toMatchObject({ clientId: s.acme.clientId, archived: true });
    const archives = await s.t.run(async (ctx) =>
      (await ctx.db.query("companyFileEvents").withIndex("by_clientId_and_at", (q) => q.eq("clientId", s.acme.clientId)).collect()).filter(
        (event) => event.action === "archive"
      )
    );
    expect(archives).toEqual([]);
  });

  test("a draft is refused while the files move, says so on the start dialog, and starts once they have moved", async () => {
    const s = await setup();
    await s.t.run((ctx) =>
      insertDocumentWithText(
        ctx,
        {
          projectId: s.acme.projectId,
          fileName: "seal notes.txt",
          fileType: "txt",
          category: "other",
          source: "context_input",
          uploadedBy: "Wendy",
          processingStatus: "ready",
          createdAt: Date.now(),
        },
        "Seal trial notes: the gasket held at 4.2 bar after two failed tries.",
        Date.now(),
        { storedText: true }
      )
    );
    await insertFiles(s, s.borealis.clientId, 150);
    await merge(s, "acme", ["borealis"]);
    expect((await s.writer.query(api.companyFiles.listForProject, { projectId: s.acme.projectId })).filesMoving).toBe(true);
    // The merged company's own project now belongs to Acme too.
    expect((await s.writer.query(api.companyFiles.listForProject, { projectId: s.borealis.projectId })).filesMoving).toBe(true);
    await expect(
      s.writer.mutation(api.generations.requestGeneration, { projectId: s.acme.projectId, candidateMode: "iterative" })
    ).rejects.toThrow(COMPANY_FILES_MOVING_MESSAGE);
    // Another company's draft is not held up.
    expect((await s.writer.query(api.companyFiles.listForProject, { projectId: s.cedar.projectId })).filesMoving).toBeUndefined();

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await s.writer.query(api.companyFiles.listForProject, { projectId: s.acme.projectId })).filesMoving).toBeUndefined();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    const generationId = await s.writer.mutation(api.generations.requestGeneration, {
      projectId: s.acme.projectId,
      candidateMode: "iterative",
    });
    expect(await s.t.run((ctx) => ctx.db.get(generationId))).toMatchObject({ status: "reserved" });
  });
});
