/// <reference types="vite/client" />
/**
 * 2026-10-26 (Phase C, step C1; decision "2026-10-26", part 1): company
 * files. Who may read, add, archive, restore and remove them; the log of
 * each change; duplicates; the server's reading; search pieces filed under
 * the company and searched only there; labels with the company's names
 * hidden; merging companies moves their files; removal and project erasure.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { getEffectiveCapabilityLevel } from "../shared/capabilities";
import { readCompanyFileText } from "./lib/companyFileText";
import { searchCompanyPieces } from "./lib/searchPieces";
import { MERGE_COMPANY_FILE_LIMIT } from "./clients";
import { SERVER_READER_VERSION } from "./lib/serverReading";
import { textPdf } from "./ai/testFiles.fixture";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const PAGES = ["Trial one held at 4.2 bar.", "Trial two failed at 3.1 bar."];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "cf-writer", role: "writer", email: "wendy@firm.com", name: "Wendy" });
    const managerId = await ctx.db.insert("users", { authId: "cf-manager", role: "manager", email: "mina@firm.com" });
    await ctx.db.insert("users", { authId: "cf-roleless" });
    const client = (name: string) =>
      ctx.db.insert("clients", { name, nameKey: dashboardCompanyKey(name), status: "active", createdBy: managerId, createdAt: now, updatedAt: now });
    const acmeId = await client("Acme");
    const otherId = await client("Borealis");
    const project = (title: string, clientName: string, clientId?: Id<"clients">) =>
      ctx.db.insert("projects", {
        title,
        clientName,
        ...(clientId ? { clientId } : {}),
        dashboardCompanyKey: dashboardCompanyKey(clientName),
        interviewer: "Ivy Interviewer",
        interviewees: ["Quentin Quill"],
        status: "draft",
        createdBy: writerId,
        ownerId: writerId,
        shareToken: `${title}-token`,
        createdAt: now,
        updatedAt: now,
      });
    return {
      writerId,
      managerId,
      acmeId,
      otherId,
      acmeProjectId: await project("Seal", "Acme", acmeId),
      otherProjectId: await project("Valve", "Borealis", otherId),
    };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "cf-writer" }),
    manager: t.withIdentity({ subject: "cf-manager" }),
    roleless: t.withIdentity({ subject: "cf-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function add(
  s: Setup,
  clientId: Id<"clients">,
  fileName: string,
  content: string,
  extra: { storageId?: Id<"_storage">; fileType?: "txt" | "pdf" } = {}
) {
  return await s.writer.mutation(api.companyFiles.addCompanyFile, {
    clientId,
    fileName,
    fileType: extra.fileType ?? "txt",
    content,
    ...(extra.storageId ? { storageId: extra.storageId } : {}),
  });
}

async function events(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query("companyFileEvents").withIndex("by_clientId_and_at", (q) => q.eq("clientId", clientId)).collect()).map(
      (event) => ({ action: event.action, fileName: event.fileName, ...(event.otherClientId ? { otherClientId: event.otherClientId } : {}) })
    )
  );
}

async function sweep(s: Setup) {
  await s.t.mutation(internal.searchPieces.sweepDueSearchPieces, {});
  await s.t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function search(s: Setup, clientId: Id<"clients">, query: string) {
  return await s.t.run(async (ctx) => await searchCompanyPieces(ctx, { clientId, query }));
}

describe("who may use company files", () => {
  test("the matrix: Consultants read and add, Managers and Admins also archive, restore and remove, Financial nothing", () => {
    expect(getEffectiveCapabilityLevel("writer", "companyFiles.read")).toBe("all");
    expect(getEffectiveCapabilityLevel("writer", "companyFiles.add")).toBe("all");
    expect(getEffectiveCapabilityLevel("writer", "companyFiles.manage")).toBe("none");
    for (const role of ["manager", "admin"] as const) {
      for (const capability of ["companyFiles.read", "companyFiles.add", "companyFiles.manage"] as const) {
        expect(getEffectiveCapabilityLevel(role, capability)).toBe("all");
      }
    }
    for (const capability of ["companyFiles.read", "companyFiles.add", "companyFiles.manage"] as const) {
      expect(getEffectiveCapabilityLevel("financial", capability)).toBe("none");
    }
  });

  test("a user with no role can do nothing; a Consultant cannot archive or remove", async () => {
    const s = await setup();
    await expect(s.roleless.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).rejects.toThrow();
    await expect(
      s.roleless.mutation(api.companyFiles.addCompanyFile, { clientId: s.acmeId, fileName: "a.txt", fileType: "txt", content: "x" })
    ).rejects.toThrow();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme has sealed pumps since 2010.");
    await expect(s.writer.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true })).rejects.toThrow(
      /permission/
    );
    await expect(s.writer.mutation(api.companyFiles.removeCompanyFile, { companyFileId: fileId })).rejects.toThrow(/permission/);
  });
});

describe("adding company files", () => {
  test("the text goes to pieces, the facts to the row, the add to the log, and the file is due for search pieces", async () => {
    const s = await setup();
    const text = "Acme has sealed pumps since 2010. ".repeat(2_000);
    const fileId = await add(s, s.acmeId, "history.txt", text);
    const file = (await s.t.run(async (ctx) => ctx.db.get(fileId)))!;
    expect(file).toMatchObject({
      clientId: s.acmeId,
      textLength: text.length,
      hasText: true,
      processingStatus: "ready",
      uploadedBy: s.writerId,
      uploaderRole: "writer",
      searchPiecesDue: true,
    });
    expect(await s.t.run(async (ctx) => readCompanyFileText(ctx, file))).toBe(text);
    expect((await s.writer.query(api.companyFiles.getCompanyFileContent, { companyFileId: fileId }))?.content).toBe(text);
    expect(await events(s, s.acmeId)).toEqual([{ action: "add", fileName: "history.txt" }]);
    const listed = await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId });
    expect(listed.files).toEqual([expect.objectContaining({ _id: fileId, fileName: "history.txt", addedBy: "Wendy", archived: false })]);
  });

  test("the same name with the same text is one file; unreadable files are never merged", async () => {
    const s = await setup();
    const first = await add(s, s.acmeId, "history.txt", "Acme history.");
    expect(await add(s, s.acmeId, "history.txt", "Acme history.")).toBe(first);
    expect(await add(s, s.acmeId, "notes.txt", "Acme history.")).not.toBe(first);
    const blankA = await add(s, s.acmeId, "scan.pdf", "", { fileType: "pdf" });
    const blankB = await add(s, s.acmeId, "scan.pdf", "", { fileType: "pdf" });
    expect(blankA).not.toBe(blankB);
    // Another company's identical file is its own.
    expect(await add(s, s.otherId, "history.txt", "Acme history.")).not.toBe(first);
  });

  test("a merged company refuses new files and names the company it joined", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.otherId, { status: "merged", mergedIntoClientId: s.acmeId }));
    await expect(add(s, s.otherId, "late.txt", "Late file.")).rejects.toThrow(/merged into Acme/);
  });

  test("an original another row already holds cannot be attached", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    await add(s, s.acmeId, "one.txt", "One.", { storageId });
    await expect(add(s, s.acmeId, "two.txt", "Two.", { storageId })).rejects.toThrow(/already in use/);
  });

  test("a company page with no company row makes one from its projects and links them", async () => {
    const s = await setup();
    const projectId = await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("dashboardCompanies", { companyKey: "cedar", clientName: "Cedar", projectCount: 1, updatedAt: now });
      return await ctx.db.insert("projects", {
        title: "Cedar project", clientName: "Cedar", dashboardCompanyKey: "cedar", status: "draft",
        createdBy: s.writerId, ownerId: s.writerId, shareToken: "cedar-token", createdAt: now, updatedAt: now,
      });
    });
    expect(await s.writer.query(api.companyFiles.companyForKey, { key: "cedar" })).toBeNull();
    const made = await s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "cedar" });
    expect(made.name).toBe("Cedar");
    expect((await s.t.run(async (ctx) => ctx.db.get(projectId)))?.clientId).toBe(made.clientId);
    expect(await s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "cedar" })).toEqual(made);
    await expect(s.writer.mutation(api.companyFiles.ensureCompanyForKey, { key: "nobody" })).rejects.toThrow(/no projects/);
  });
});

describe("archiving, restoring and removing", () => {
  test("a Manager archives and restores; each change is logged; archived files list apart", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme history.");
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).files).toEqual([]);
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId, archived: true })).files).toHaveLength(1);
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: false });
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).files).toHaveLength(1);
    expect((await events(s, s.acmeId)).map((event) => event.action)).toEqual(["add", "archive", "restore"]);
  });

  test("removal deletes the row, its text, its search pieces and its original, and is logged", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["bytes"])));
    const fileId = await add(s, s.acmeId, "history.txt", "Acme sealed pumps with graphite.", { storageId });
    await sweep(s);
    expect((await search(s, s.acmeId, "graphite")).hits).toHaveLength(1);
    await s.manager.mutation(api.companyFiles.removeCompanyFile, { companyFileId: fileId });
    const left = await s.t.run(async (ctx) => ({
      row: await ctx.db.get(fileId),
      texts: await ctx.db.query("companyFileTexts").withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", fileId)).collect(),
      pieces: await ctx.db.query("documentSearchPieces").withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", fileId)).collect(),
      original: await ctx.storage.get(storageId),
    }));
    expect(left).toEqual({ row: null, texts: [], pieces: [], original: null });
    expect((await events(s, s.acmeId)).map((event) => event.action)).toEqual(["add", "remove"]);
  });

  test("erasing a company's last project leaves its company files", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme history.");
    const { PROJECT_SCOPED_TABLES } = await import("./lib/projectScopedTables");
    const tables = PROJECT_SCOPED_TABLES.map((entry: { table: string }) => entry.table);
    for (const table of ["companyFiles", "companyFileTexts", "companyFileEvents"]) expect(tables).not.toContain(table);
    expect(await s.t.run(async (ctx) => ctx.db.get(fileId))).not.toBeNull();
  });
});

describe("search pieces and labels", () => {
  test("pieces are filed under the company and found only there, never for an archived file", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme sealed pumps with graphite packing in 2019.");
    await add(s, s.otherId, "valves.txt", "Borealis tested graphite valves.");
    await sweep(s);
    const pieces = await s.t.run(async (ctx) =>
      ctx.db.query("documentSearchPieces").withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", fileId)).collect()
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(piece.clientId).toBe(s.acmeId);
      expect(piece.projectId).toBeUndefined();
      expect(piece.documentId).toBeUndefined();
    }
    const found = await search(s, s.acmeId, "graphite packing");
    expect(found).toMatchObject({ complete: true, hits: [expect.objectContaining({ companyFileId: fileId, fileName: "history.txt" })] });
    // A project's own search never sees company pieces.
    const projectSearch = await s.t.query(internal.searchPieces.searchProject, { projectId: s.acmeProjectId, query: "graphite" });
    expect(projectSearch.hits).toEqual([]);
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: fileId, archived: true });
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([]);
  });

  test("a file not cut yet makes the search incomplete; cutting marks labels due", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme graphite.");
    expect((await search(s, s.acmeId, "graphite")).complete).toBe(false);
    await sweep(s);
    expect((await search(s, s.acmeId, "graphite")).complete).toBe(true);
    expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.labelsDue).toBe(true);
  });

  test("a label call hides the company's names, its old names and its projects' people", async () => {
    const s = await setup();
    await s.t.run(async (ctx) =>
      ctx.db.insert("clients", {
        name: "Acme Holdings", nameKey: "acme holdings", status: "merged", mergedIntoClientId: s.acmeId,
        createdBy: s.managerId, createdAt: Date.now(), updatedAt: Date.now(),
      })
    );
    const fileId = await add(s, s.acmeId, "history.txt", "Acme Holdings hired Quentin Quill; Ivy Interviewer met him.");
    const input = (await s.t.query(internal.companyFileWork.companyLabelInput, { companyFileId: fileId }))!;
    const hidden = input.placeholders.map((entry) => entry.value);
    for (const name of ["Acme", "Acme Holdings", "Quentin Quill", "Ivy Interviewer"]) expect(hidden).toContain(name);
    // The other company's names are not in this company's map.
    expect(hidden).not.toContain("Borealis");
  });

  test("labels are kept only for the text and name they were made from", async () => {
    const s = await setup();
    const fileId = await add(s, s.acmeId, "history.txt", "Acme graphite.");
    const file = (await s.t.run(async (ctx) => ctx.db.get(fileId)))!;
    const save = (textHash: string) =>
      s.t.mutation(internal.companyFileWork.saveCompanyFileLabels, {
        companyFileId: fileId, textHash, fileName: "history.txt", model: "claude-haiku-5-5", promptVersion: "file-labels-2",
        labels: { documentType: "other", fiscalYear: null, title: "Acme history", summary: "How Acme seals pumps." },
      });
    expect(await save("not-the-hash")).toBe("changed");
    expect(await save(file.textHash)).toBe("kept");
    expect((await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: s.acmeId })).files[0]?.labels).toMatchObject({
      title: "Acme history",
    });
  });
});

describe("the server's reading", () => {
  test("a PDF the browser could not read is queued, read on the server, and kept", async () => {
    const s = await setup();
    const storageId = await s.t.run(async (ctx) =>
      ctx.storage.store(new Blob([textPdf(PAGES) as BlobPart], { type: "application/pdf" }))
    );
    const fileId = await add(s, s.acmeId, "trials.pdf", "", { storageId, fileType: "pdf" });
    const jobs = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("readStoredCompanyFile"))).toEqual([
      expect.objectContaining({ args: [{ companyFileId: fileId }] }),
    ]);
    await s.t.action(internal.ai.fileReading.readStoredCompanyFile, { companyFileId: fileId });
    const file = (await s.t.run(async (ctx) => ctx.db.get(fileId)))!;
    expect(file).toMatchObject({ processingStatus: "ready", pageCount: 2, serverReader: SERVER_READER_VERSION, searchPiecesDue: true });
    const text = await s.t.run(async (ctx) => readCompanyFileText(ctx, file));
    for (const page of PAGES) expect(text).toContain(page);
    // Read once: not read again.
    expect(await s.t.mutation(internal.companyFileWork.startCompanyFileReading, { companyFileId: fileId })).toBeNull();
  });
});

describe("merging companies", () => {
  async function companyKeys(s: Setup) {
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("dashboardCompanies", { companyKey: "acme", clientName: "Acme", projectCount: 1, updatedAt: now });
      await ctx.db.insert("dashboardCompanies", { companyKey: "borealis", clientName: "Borealis", projectCount: 1, updatedAt: now });
    });
  }

  test("the merged company's files move to the kept company in the same step, logged on both, and are cut again", async () => {
    const s = await setup();
    await companyKeys(s);
    const moved = await add(s, s.otherId, "valves.txt", "Borealis tested graphite valves.");
    const archived = await add(s, s.otherId, "old.txt", "An old Borealis file.");
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: archived, archived: true });
    await sweep(s);
    expect((await search(s, s.otherId, "graphite")).hits).toHaveLength(1);

    const preview = await s.manager.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(preview).toMatchObject({ companyFileCount: 2, tooManyCompanyFiles: false });
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] });

    for (const fileId of [moved, archived]) {
      expect((await s.t.run(async (ctx) => ctx.db.get(fileId)))?.clientId).toBe(s.acmeId);
    }
    expect((await s.t.run(async (ctx) => ctx.db.get(moved)))?.searchPiecesDue).toBe(true);
    // Until cut again, its old pieces count for neither company.
    expect((await search(s, s.otherId, "graphite")).hits).toEqual([]);
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([]);
    await sweep(s);
    expect((await search(s, s.acmeId, "graphite")).hits).toEqual([expect.objectContaining({ companyFileId: moved })]);

    expect((await events(s, s.otherId)).filter((event) => event.action === "merge_out")).toEqual([
      { action: "merge_out", fileName: "valves.txt", otherClientId: s.acmeId },
      { action: "merge_out", fileName: "old.txt", otherClientId: s.acmeId },
    ]);
    expect((await events(s, s.acmeId)).filter((event) => event.action === "merge_in")).toHaveLength(2);
    // The merged company takes no new files.
    await expect(add(s, s.otherId, "late.txt", "Late.")).rejects.toThrow(/merged into Acme/);
  });

  test("a merge that would move more than the file limit is refused whole", async () => {
    const s = await setup();
    await companyKeys(s);
    await s.t.run(async (ctx) => {
      for (let i = 0; i <= MERGE_COMPANY_FILE_LIMIT; i++) {
        await ctx.db.insert("companyFiles", {
          clientId: s.otherId, fileName: `f${i}.txt`, fileType: "txt", textLength: 0, hasText: false, textHash: "empty",
          textPreview: "", wordCount: 0, processingStatus: "could_not_read", uploadedBy: s.writerId, createdAt: Date.now(),
        });
      }
    });
    const preview = await s.manager.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["borealis"] });
    expect(preview.tooManyCompanyFiles).toBe(true);
    await expect(s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["borealis"] })).rejects.toThrow(
      /company files/
    );
    expect((await s.t.run(async (ctx) => ctx.db.get(s.otherId)))?.status).toBe("active");
  });
});
