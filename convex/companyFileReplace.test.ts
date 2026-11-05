/// <reference types="vite/client" />
/**
 * 2026-11-04 (the company profile, Files): Edit details sets a company
 * file's category and fiscal year label for everyone who may add company
 * files; Replace file (Managers and Admins) stores a new original for the
 * same file, reads it as its new text, keeps the text versions drafts
 * already used, and logs `replaced`. Every name and passage is made up.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { companyFileTextFacts, insertCompanyFileTextPieces, readCompanyFileText } from "./lib/companyFileText";
import { sourceRowText, storedSourceTextVersion } from "./lib/sourceText";
import { SERVER_READER_VERSION } from "./lib/serverReading";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const OLD_TEXT = "Quillmere Pumps tested seal batch A at 4.2 bar in March.";
const NEW_TEXT = "Quillmere Pumps tested seal batch B at 5.0 bar in June, after the redesign.";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", { authId: "rf-writer", role: "writer", email: "wren@firm.example", name: "Wren" });
    const managerId = await ctx.db.insert("users", { authId: "rf-manager", role: "manager", email: "milo@firm.example", name: "Milo" });
    await ctx.db.insert("users", { authId: "rf-admin", role: "admin", email: "ada@firm.example" });
    await ctx.db.insert("users", { authId: "rf-roleless" });
    const clientId = await ctx.db.insert("clients", {
      name: "Quillmere Pumps", nameKey: dashboardCompanyKey("Quillmere Pumps"), status: "active", createdBy: managerId, createdAt: now, updatedAt: now,
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seals", clientName: "Quillmere Pumps", clientId, dashboardCompanyKey: dashboardCompanyKey("Quillmere Pumps"),
      status: "draft", createdBy: writerId, ownerId: writerId, shareToken: "rf-token", createdAt: now, updatedAt: now,
    });
    return { writerId, managerId, clientId, projectId };
  });
  const writer = t.withIdentity({ subject: "rf-writer" });
  const fileId = await writer.mutation(api.companyFiles.addCompanyFile, {
    clientId: ids.clientId,
    fileName: "seal trials.txt",
    fileType: "txt",
    content: OLD_TEXT,
    category: "background",
    storageId: await t.run((ctx) => ctx.storage.store(new Blob([OLD_TEXT], { type: "text/plain" }))),
  });
  return {
    t,
    ...ids,
    fileId,
    writer,
    manager: t.withIdentity({ subject: "rf-manager" }),
    admin: t.withIdentity({ subject: "rf-admin" }),
    roleless: t.withIdentity({ subject: "rf-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function storeBlob(s: Setup, text: string, type = "text/plain") {
  return s.t.run((ctx) => ctx.storage.store(new Blob([text], { type })));
}

async function replaceArgs(s: Setup, fileName = "seal trials, v2.txt", text = NEW_TEXT) {
  return {
    companyFileId: s.fileId,
    fileName,
    fileType: "txt" as const,
    content: text,
    storageId: await storeBlob(s, text),
    mimeType: "text/plain",
  };
}

async function events(s: Setup) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query("companyFileEvents").withIndex("by_clientId_and_at", (q) => q.eq("clientId", s.clientId)).collect()).map(
      (event) => ({ action: event.action, fileName: event.fileName, ...(event.previousFileName ? { previousFileName: event.previousFileName } : {}) })
    )
  );
}

async function listed(s: Setup) {
  const { files } = await s.manager.query(api.companyFiles.listCompanyFiles, { clientId: s.clientId });
  return files.find((file) => file._id === s.fileId)!;
}

describe("Edit details", () => {
  test("Consultants, Managers and Admins set the category and fiscal year; the list shows them", async () => {
    const s = await setup();
    await s.writer.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "previous_pd", fiscalYear: 2025 });
    expect(await listed(s)).toMatchObject({ category: "previous_pd", fiscalYear: 2025 });
    await s.manager.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "scoping_notes", fiscalYear: 2026 });
    expect(await listed(s)).toMatchObject({ category: "scoping_notes", fiscalYear: 2026 });
    await s.admin.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: null, fiscalYear: null });
    const cleared = await listed(s);
    expect(cleared.category).toBeNull();
    // A person said the file has no fiscal year: null, not left to the AI label.
    expect(cleared.fiscalYear).toBeNull();
  });

  test("a file nobody filed under a year lists no fiscal year of its own", async () => {
    const s = await setup();
    expect((await listed(s)).fiscalYear).toBeUndefined();
  });

  test("users with no role are refused; a year out of range is refused", async () => {
    const s = await setup();
    await expect(
      s.roleless.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "other", fiscalYear: 2025 })
    ).rejects.toThrow();
    await expect(
      s.writer.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "other", fiscalYear: 20255 })
    ).rejects.toThrow(/fiscal year between/);
    await expect(
      s.writer.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "other", fiscalYear: 2025.5 })
    ).rejects.toThrow(/fiscal year between/);
    expect(await listed(s)).toMatchObject({ category: "background" });
  });

  test("details change no text, no labels and log nothing", async () => {
    const s = await setup();
    const before = await s.t.run((ctx) => ctx.db.get(s.fileId));
    await s.writer.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "other", fiscalYear: 2024 });
    const after = await s.t.run((ctx) => ctx.db.get(s.fileId));
    expect(after!.textHash).toBe(before!.textHash);
    expect(after!.labels).toEqual(before!.labels);
    expect(await events(s)).toEqual([{ action: "add", fileName: "seal trials.txt" }]);
  });
});

describe("Replace file", () => {
  test("Consultants and users with no role are refused, and the file is unchanged", async () => {
    const s = await setup();
    for (const caller of [s.writer, s.roleless]) {
      await expect(caller.mutation(api.companyFiles.replaceCompanyFile, await replaceArgs(s))).rejects.toThrow();
    }
    const file = await s.t.run((ctx) => ctx.db.get(s.fileId));
    expect(file!.fileName).toBe("seal trials.txt");
    expect(await s.t.run((ctx) => readCompanyFileText(ctx, file!))).toBe(OLD_TEXT);
    expect(await events(s)).toEqual([{ action: "add", fileName: "seal trials.txt" }]);
  });

  test("a Manager's replacement keeps the file, takes the new original, text and name, and logs replaced", async () => {
    const s = await setup();
    await s.manager.mutation(api.companyFiles.updateCompanyFileDetails, { companyFileId: s.fileId, category: "previous_pd", fiscalYear: 2025 });
    const oldStorageId = (await s.t.run((ctx) => ctx.db.get(s.fileId)))!.storageId!;
    const args = await replaceArgs(s);
    await s.manager.mutation(api.companyFiles.replaceCompanyFile, args);
    const file = (await s.t.run((ctx) => ctx.db.get(s.fileId)))!;
    expect(file.fileName).toBe("seal trials, v2.txt");
    expect(file.storageId).toBe(args.storageId);
    expect(file.category).toBe("previous_pd");
    expect(file.fiscalYear).toBe(2025);
    expect(file.textHash).toBe((await companyFileTextFacts(NEW_TEXT)).textHash);
    expect(file.labels).toBeUndefined();
    expect(file.searchPiecesDue).toBe(true);
    expect(await s.t.run((ctx) => readCompanyFileText(ctx, file))).toBe(NEW_TEXT);
    // The old original goes: nothing else holds it.
    expect(await s.t.run((ctx) => ctx.storage.get(oldStorageId))).toBeNull();
    expect(await events(s)).toEqual([
      { action: "add", fileName: "seal trials.txt" },
      { action: "replaced", fileName: "seal trials, v2.txt", previousFileName: "seal trials.txt" },
    ]);
  });

  test("the same name logs no earlier name; sending the same original again changes nothing", async () => {
    const s = await setup();
    const args = await replaceArgs(s, "seal trials.txt");
    await s.admin.mutation(api.companyFiles.replaceCompanyFile, args);
    await s.admin.mutation(api.companyFiles.replaceCompanyFile, args);
    expect(await events(s)).toEqual([
      { action: "add", fileName: "seal trials.txt" },
      { action: "replaced", fileName: "seal trials.txt" },
    ]);
  });

  test("drafts that used the old text keep it; later drafts read the new text", async () => {
    const s = await setup();
    // A draft froze the file's old text as a stored version (2026-10-27, sixth).
    const draftRowId = await s.t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", { projectId: s.projectId, status: "completed", startedAt: now });
      const textHash = (await companyFileTextFacts(OLD_TEXT)).textHash;
      const { versionId } = await storedSourceTextVersion(ctx, { companyFileId: s.fileId, clientId: s.clientId }, OLD_TEXT, textHash);
      return await ctx.db.insert("generationSources", {
        generationId, projectId: s.projectId, kind: "company_file", companyFileId: s.fileId, clientId: s.clientId,
        label: "background:seal trials.txt", textVersionId: versionId, textLength: OLD_TEXT.length, contentHash: textHash,
        truncated: false, originalLength: OLD_TEXT.length, capturedAt: now,
      });
    });
    await s.manager.mutation(api.companyFiles.replaceCompanyFile, await replaceArgs(s));
    await s.t.mutation(internal.sourceTextSweep.sweepCompanyTextVersions, { companyFileId: s.fileId });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const draftText = await s.t.run(async (ctx) => sourceRowText(ctx, (await ctx.db.get(draftRowId))!));
    expect(draftText).toBe(OLD_TEXT);
    // A later draft stores the new text as a version of its own.
    await s.t.run(async (ctx) => {
      const file = (await ctx.db.get(s.fileId))!;
      const current = await readCompanyFileText(ctx, file);
      expect(current).toBe(NEW_TEXT);
      const { versionId } = await storedSourceTextVersion(ctx, { companyFileId: s.fileId, clientId: s.clientId }, current, file.textHash);
      const versions = await ctx.db
        .query("sourceTextVersions")
        .withIndex("by_companyFileId_and_textHash", (q) => q.eq("companyFileId", s.fileId))
        .collect();
      expect(versions.map((version) => version._id)).toContain(versionId);
      expect(versions).toHaveLength(2);
    });
  });

  test("an archived file is not replaced; a held original is refused", async () => {
    const s = await setup();
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: s.fileId, archived: true });
    await expect(s.manager.mutation(api.companyFiles.replaceCompanyFile, await replaceArgs(s))).rejects.toThrow(/Restore this file/);
    await s.manager.mutation(api.companyFiles.setCompanyFileArchived, { companyFileId: s.fileId, archived: false });
    const other = await s.writer.mutation(api.companyFiles.addCompanyFile, {
      clientId: s.clientId, fileName: "other.txt", fileType: "txt", content: "Another file entirely.", storageId: await storeBlob(s, "Another"),
    });
    const held = (await s.t.run((ctx) => ctx.db.get(other)))!.storageId!;
    await expect(
      s.manager.mutation(api.companyFiles.replaceCompanyFile, { ...(await replaceArgs(s)), storageId: held })
    ).rejects.toThrow(/already in use/);
  });

  test("an unreadable new original is read on the server, and a reading of the old original does not land on it", async () => {
    const s = await setup();
    // The old original was being read when the file was replaced.
    const unreadable = await s.writer.mutation(api.companyFiles.addCompanyFile, {
      clientId: s.clientId, fileName: "scan.pdf", fileType: "pdf", content: "",
      storageId: await storeBlob(s, "%PDF-1.4 not really", "application/pdf"),
    });
    const claim = await s.t.mutation(internal.companyFileWork.startCompanyFileReading, { companyFileId: unreadable });
    expect(claim).not.toBeNull();
    await s.manager.mutation(api.companyFiles.replaceCompanyFile, {
      companyFileId: unreadable, fileName: "scan v2.pdf", fileType: "pdf", content: "",
      storageId: await storeBlob(s, "%PDF-1.4 still not", "application/pdf"),
    });
    // Both texts are empty, so only the claim's original tells them apart.
    expect(
      await s.t.mutation(internal.companyFileWork.saveCompanyFileReading, {
        companyFileId: unreadable, expectedTextHash: claim!.textHash, text: "Text read from the old scan.", reader: SERVER_READER_VERSION,
      })
    ).toBe("changed");
    const scheduled = await s.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.state.kind === "pending").map((job) => job.name)
    );
    expect(scheduled.some((name) => name.includes("readStoredCompanyFile"))).toBe(true);
  });
});

describe("several files at once (the selection bar)", () => {
  async function addMore(s: Setup, names: string[]) {
    const ids = [s.fileId];
    for (const name of names) {
      ids.push(
        await s.writer.mutation(api.companyFiles.addCompanyFile, { clientId: s.clientId, fileName: name, fileType: "txt", content: `Text of ${name}.` })
      );
    }
    return ids;
  }

  async function otherCompanyFile(s: Setup) {
    const otherId = await s.t.run(async (ctx) =>
      ctx.db.insert("clients", { name: "Borealis", nameKey: "borealis", status: "active", createdBy: s.managerId, createdAt: 0, updatedAt: 0 })
    );
    return await s.writer.mutation(api.companyFiles.addCompanyFile, { clientId: otherId, fileName: "theirs.txt", fileType: "txt", content: "Theirs." });
  }

  test("Move to fiscal year files every selected file under one year, for Consultants; no role is refused", async () => {
    const s = await setup();
    const ids = await addMore(s, ["a.txt", "b.txt"]);
    expect(await s.writer.mutation(api.companyFiles.setCompanyFilesFiscalYear, { clientId: s.clientId, companyFileIds: ids, fiscalYear: 2026 })).toEqual({ changed: 3 });
    const years = await s.t.run(async (ctx) => Promise.all(ids.map(async (id) => (await ctx.db.get(id))!.fiscalYear)));
    expect(years).toEqual([2026, 2026, 2026]);
    expect(await s.writer.mutation(api.companyFiles.setCompanyFilesFiscalYear, { clientId: s.clientId, companyFileIds: ids, fiscalYear: null })).toEqual({ changed: 3 });
    await expect(
      s.roleless.mutation(api.companyFiles.setCompanyFilesFiscalYear, { clientId: s.clientId, companyFileIds: ids, fiscalYear: 2026 })
    ).rejects.toThrow();
    await expect(
      s.writer.mutation(api.companyFiles.setCompanyFilesFiscalYear, { clientId: s.clientId, companyFileIds: ids, fiscalYear: 3000 })
    ).rejects.toThrow(/fiscal year between/);
    // Details are not logged: only the adds.
    expect((await events(s)).map((event) => event.action)).toEqual(["add", "add", "add"]);
  });

  test("a selection is bounded, has no repeats and holds only this company's files", async () => {
    const s = await setup();
    const tooMany = Array.from({ length: 201 }, () => s.fileId);
    await expect(
      s.writer.mutation(api.companyFiles.setCompanyFilesFiscalYear, { clientId: s.clientId, companyFileIds: tooMany, fiscalYear: 2026 })
    ).rejects.toThrow(/at most 200 files/);
    await expect(
      s.writer.mutation(api.companyFiles.setCompanyFilesFiscalYear, { clientId: s.clientId, companyFileIds: [s.fileId, s.fileId], fiscalYear: 2026 })
    ).rejects.toThrow(/selected twice/);
    const theirs = await otherCompanyFile(s);
    await expect(
      s.manager.mutation(api.companyFiles.setCompanyFilesArchived, { clientId: s.clientId, companyFileIds: [s.fileId, theirs], archived: true })
    ).rejects.toThrow(/another company/);
    await expect(s.manager.mutation(api.companyFiles.removeCompanyFiles, { clientId: s.clientId, companyFileIds: [theirs] })).rejects.toThrow(/another company/);
    const removeTooMany = (await addMore(s, Array.from({ length: 50 }, (_, i) => `f${i}.txt`)));
    await expect(s.manager.mutation(api.companyFiles.removeCompanyFiles, { clientId: s.clientId, companyFileIds: removeTooMany })).rejects.toThrow(/at most 50 files/);
    // Nothing was changed by a refused call.
    expect((await s.t.run((ctx) => ctx.db.get(s.fileId)))!.archived).toBeUndefined();
  });

  test("Archive and its Undo take the whole selection for Managers, each file logged; Consultants are refused", async () => {
    const s = await setup();
    const ids = await addMore(s, ["a.txt"]);
    await expect(s.writer.mutation(api.companyFiles.setCompanyFilesArchived, { clientId: s.clientId, companyFileIds: ids, archived: true })).rejects.toThrow();
    expect(await s.manager.mutation(api.companyFiles.setCompanyFilesArchived, { clientId: s.clientId, companyFileIds: ids, archived: true })).toEqual({ changed: ids });
    const { files } = await s.manager.query(api.companyFiles.listCompanyFiles, { clientId: s.clientId });
    expect(files).toEqual([]);
    // Undo restores only what this call archived; an already active file is untouched.
    expect(await s.manager.mutation(api.companyFiles.setCompanyFilesArchived, { clientId: s.clientId, companyFileIds: ids, archived: false })).toEqual({ changed: ids });
    expect((await events(s)).map((event) => event.action)).toEqual(["add", "add", "archive", "archive", "restore", "restore"]);
  });

  test("Delete removes every selected file for Admins, each logged; Consultants are refused", async () => {
    const s = await setup();
    const ids = await addMore(s, ["a.txt", "b.txt"]);
    await expect(s.writer.mutation(api.companyFiles.removeCompanyFiles, { clientId: s.clientId, companyFileIds: ids })).rejects.toThrow();
    expect(await s.admin.mutation(api.companyFiles.removeCompanyFiles, { clientId: s.clientId, companyFileIds: ids })).toEqual({ removed: 3 });
    expect(await s.t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))))).toEqual([null, null, null]);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.run((ctx) => ctx.db.query("companyFileTexts").collect())).toEqual([]);
    expect((await events(s)).filter((event) => event.action === "remove").map((event) => event.fileName)).toEqual(["seal trials.txt", "a.txt", "b.txt"]);
    // A file already gone is skipped, not refused.
    expect(await s.admin.mutation(api.companyFiles.removeCompanyFiles, { clientId: s.clientId, companyFileIds: [ids[0]!] })).toEqual({ removed: 0 });
  });
});

describe("Delete of many large files", () => {
  test("50 files of 500,000 characters are deleted within Convex's limits; their text and pieces go in later steps", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { clientId, managerId } = await t.run(async (ctx) => {
      const managerId = await ctx.db.insert("users", { authId: "big-manager", role: "manager" });
      const clientId = await ctx.db.insert("clients", { name: "Big Co", nameKey: "big co", status: "active", createdBy: managerId, createdAt: 0, updatedAt: 0 });
      return { clientId, managerId };
    });
    const text = "Seal trial notes. ".repeat(27_778).slice(0, 500_000);
    const facts = await companyFileTextFacts(text);
    const ids: Id<"companyFiles">[] = [];
    // A few per step: each step writes under the limits too.
    for (let batch = 0; batch < 25; batch++) {
      ids.push(
        ...(await t.run(async (ctx) => {
          const made: Id<"companyFiles">[] = [];
          for (let i = 0; i < 2; i++) {
            const id = await ctx.db.insert("companyFiles", {
              clientId, fileName: `big ${batch}-${i}.txt`, fileType: "txt", ...facts, processingStatus: "ready", uploadedBy: managerId, createdAt: 0,
            });
            await insertCompanyFileTextPieces(ctx, id, text);
            made.push(id);
          }
          return made;
        }))
      );
    }
    const manager = t.withIdentity({ subject: "big-manager" });
    // Reading all their text in one transaction is over the limit (the old Delete did).
    await expect(t.run(async (ctx) => (await ctx.db.query("companyFileTexts").collect()).length)).rejects.toThrow();
    expect(await manager.mutation(api.companyFiles.removeCompanyFiles, { clientId, companyFileIds: ids })).toEqual({ removed: 50 });
    expect(await t.run(async (ctx) => (await ctx.db.query("companyFiles").collect()).length)).toBe(0);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(async (ctx) => (await ctx.db.query("companyFileTexts").take(1)).length)).toBe(0);
  });
});

describe("the website file", () => {
  test("is never replaced by hand, and the list marks it", async () => {
    const s = await setup();
    await s.t.run((ctx) => ctx.db.patch(s.clientId, { websiteFileId: s.fileId }));
    expect((await listed(s)).fromWebsite).toBe(true);
    await expect(s.manager.mutation(api.companyFiles.replaceCompanyFile, await replaceArgs(s))).rejects.toThrow(
      "This file comes from the website. Change the website in Edit company, or use Read again."
    );
    expect((await s.t.run((ctx) => ctx.db.get(s.fileId)))!.fileName).toBe("seal trials.txt");
  });

  test("other files list their original's size", async () => {
    const s = await setup();
    const file = await listed(s);
    expect(file.fromWebsite).toBe(false);
    expect(file.bytes).toBe(new Blob([OLD_TEXT]).size);
  });
});

