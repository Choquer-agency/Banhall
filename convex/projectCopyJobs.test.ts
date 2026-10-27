/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deleteDocumentText, insertDocumentWithText, readDocumentText, writeDocumentText } from "./lib/documentText";
import { PROJECT_STILL_COPYING_MESSAGE, projectCopyInProgress } from "./lib/projectCopy";
import { completeProjectCopy } from "./projectCopy.fixture";

const modules = import.meta.glob("./**/*.ts");

/**
 * F2 (2026-10-27, `docs/todos/phase-f-scale.md`): a project copy makes the
 * new project's rows first, then copies each file's text whole in its own
 * transaction. Every name and passage here is fictional.
 */

const AUTH_ID = "copy-writer";

type Setup = Awaited<ReturnType<typeof setup>>;

/**
 * Two projects of one writer: the original, with `files` (each inserted in
 * its own transaction, so Convex's limits can be on), and a new empty one.
 * `older: true` keeps a file's text on its row, as rows made before the text
 * move did.
 */
async function setup(
  files: Array<{ text: string; older?: boolean; original?: boolean }>,
  options: { transactionLimits?: boolean } = {}
) {
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
  const now = Date.now() - 10_000;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "writer", name: "Wren Writer" });
    const project = { clientName: "Quillmere Seals", status: "draft" as const, createdBy: userId, ownerId: userId, createdAt: now, updatedAt: now };
    const fromProjectId = await ctx.db.insert("projects", { ...project, title: "Seals", shareToken: "copy-from" });
    const toProjectId = await ctx.db.insert("projects", { ...project, title: "Seals (copy)", shareToken: "copy-to" });
    return { userId, fromProjectId, toProjectId };
  });
  const sourceIds: Id<"projectDocuments">[] = [];
  for (const [index, file] of files.entries()) {
    sourceIds.push(
      await t.run(async (ctx) => {
        const storageId = file.original ? await ctx.storage.store(new Blob([`original ${index}`])) : undefined;
        const fields = {
          projectId: ids.fromProjectId,
          fileName: `notes-${index}.txt`,
          fileType: "txt" as const,
          category: "other" as const,
          source: "context_input",
          uploadedBy: "Wren Writer",
          processingStatus: "ready" as const,
          ...(storageId ? { storageId } : {}),
          createdAt: now + index,
        };
        return file.older
          ? await ctx.db.insert("projectDocuments", { ...fields, content: file.text })
          : await insertDocumentWithText(ctx, fields, file.text, now + index, { storedText: true });
      })
    );
  }
  const writer = t.withIdentity({ subject: AUTH_ID });
  const prepare = () =>
    writer.mutation(internal.projects.prepareProjectContentCopy, {
      fromProjectId: ids.fromProjectId,
      toProjectId: ids.toProjectId,
      requireFreshTarget: true,
    });
  const copies = () =>
    t.run((ctx) =>
      ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", ids.toProjectId)).collect()
    );
  const job = (jobId: Id<"projectCopyJobs">) => t.run((ctx) => ctx.db.get(jobId));
  const storedFiles = () => t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).map((file) => file._id));
  return { t, ...ids, sourceIds, writer, prepare, copies, job, storedFiles };
}

/** The text of a file, read in its own transaction. */
async function textOf(s: Setup, documentId: Id<"projectDocuments">): Promise<string> {
  return await s.t.run(async (ctx) => readDocumentText(ctx, (await ctx.db.get(documentId))!));
}

/** Copies the next pending file as the copy action does, with an optional clone. */
async function copyNext(s: Setup, { jobId, leaseToken }: { jobId: Id<"projectCopyJobs">; leaseToken: string }, withClone = false) {
  const plan = { jobId, leaseToken };
  const next = await s.t.query(internal.projects.nextProjectCopyFile, plan);
  if (!next) return null;
  const clone = withClone ? await s.t.run((ctx) => ctx.storage.store(new Blob(["clone"]))) : undefined;
  const outcome = await s.t.mutation(internal.projects.copyProjectFile, {
    ...plan,
    documentId: next.documentId,
    ...(clone ? { cloneStorageId: clone } : {}),
  });
  return { documentId: next.documentId, clone, outcome };
}

const words = (index: number, chars: number) => `File ${index}. ` + "seal ".repeat(Math.ceil(chars / 5)).slice(0, chars - `File ${index}. `.length);

describe("a project copy, file by file (F2)", () => {
  it("copies 60 files of 400,000 characters within Convex's transaction limits, with the receipt the wizard reads", async () => {
    // 24 million characters: one transaction could hold neither the reads
    // nor the writes of this copy.
    const s = await setup(Array.from({ length: 60 }, (_, index) => ({ text: words(index, 400_000) })), { transactionLimits: true });
    const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: s.fromProjectId,
      toProjectId: s.toProjectId,
    });
    expect(result.documentsCopied).toBe(60);
    expect(result.documents.map((row) => row.sourceId)).toEqual(s.sourceIds);
    const copies = await s.copies();
    expect(copies).toHaveLength(60);
    for (const copy of copies) {
      expect(copy.textCopyState).toBeUndefined();
      expect(copy.searchPiecesDue).toBe(true);
      const receipt = result.documents.find((row) => row.documentId === copy._id)!;
      expect(copy.copiedFromDocumentId).toBe(receipt.sourceId);
      const source = await s.t.run((ctx) => ctx.db.get(receipt.sourceId));
      expect(copy).toMatchObject({ textHash: source!.textHash, textLength: 400_000, fileName: source!.fileName });
    }
    expect(await textOf(s, copies[7]!._id)).toBe(words(7, 400_000));
    expect(await s.t.run((ctx) => projectCopyInProgress(ctx, s.toProjectId))).toBe(false);
  });

  it("makes the rows of a project too large for one transaction over several, every row read", async () => {
    // Older rows keep their whole text on the row: 40 of 400,000 characters
    // is 16 MB of rows to read.
    const s = await setup(Array.from({ length: 40 }, (_, index) => ({ text: words(index, 400_000), older: true })), {
      transactionLimits: true,
    });
    const plan = await s.prepare();
    expect(plan.prepared).toBe(false);
    expect(plan.documents.length).toBeGreaterThan(0);
    expect(plan.documents.length).toBeLessThan(40);
    await completeProjectCopy(s.t, plan);
    const copies = await s.copies();
    expect(copies).toHaveLength(40);
    expect(copies.every((copy) => copy.textCopyState === undefined)).toBe(true);
    expect(new Set(copies.map((copy) => copy.copiedFromDocumentId))).toEqual(new Set(s.sourceIds));
    expect(await textOf(s, copies[39]!._id)).toBe(words(39, 400_000));
  });

  it("refuses a draft while files are pending, and allows one once they are copied", async () => {
    const s = await setup([{ text: "Seal test notes, run one." }]);
    const plan = await s.prepare();
    expect(plan.prepared).toBe(true);
    expect((await s.copies())[0]).toMatchObject({ textCopyState: "pending", hasText: true });
    expect(await s.t.run((ctx) => projectCopyInProgress(ctx, s.toProjectId))).toBe(true);
    await expect(
      s.writer.mutation(api.generations.requestGeneration, { projectId: s.toProjectId, candidateMode: "iterative" })
    ).rejects.toThrow(PROJECT_STILL_COPYING_MESSAGE);
    await completeProjectCopy(s.t, plan);
    expect(await s.t.run((ctx) => projectCopyInProgress(ctx, s.toProjectId))).toBe(false);
    expect(await s.job(plan.jobId)).toMatchObject({ status: "done", filesCopied: 1, filesFailed: 0 });
  });

  it("leaves a pending file out of search pieces, server reading, labels, previews and the file list's reading", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup([{ text: "Seal test notes, run one.", original: true }]);
      await s.prepare();
      const [copy] = await s.copies();
      await s.t.mutation(internal.searchPieces.markSearchPiecesDue, {});
      await s.t.mutation(internal.fileLabels.markFileLabelsDue, {});
      await s.t.mutation(internal.documentReading.queueServerReadings, {});
      const after = await s.t.run((ctx) => ctx.db.get(copy!._id));
      expect(after).toMatchObject({ textCopyState: "pending" });
      expect(after?.searchPiecesDue).toBeUndefined();
      expect(after?.labelsDue).toBeUndefined();
      expect(await s.t.query(internal.searchPieces.fileToIndex, { documentId: copy!._id })).toBeNull();
      expect(await s.t.mutation(internal.documentReading.startServerReading, { documentId: copy!._id })).toBeNull();
      expect(await s.t.query(internal.fileLabels.labelInput, { documentId: copy!._id })).toBeNull();
      expect(await s.writer.query(api.documents.getDocumentContent, { documentId: copy!._id })).toMatchObject({ content: "" });
      const listed = await s.writer.query(api.documents.listDocuments, { projectId: s.toProjectId });
      expect(listed).toEqual([expect.objectContaining({ copyState: "copying", processingStatus: "ready" })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a file removed or changed in the original meanwhile 'could not copy', and copies the rest", async () => {
    const s = await setup([{ text: "Kept the same." }, { text: "Changed meanwhile." }, { text: "Removed meanwhile." }]);
    const plan = await s.prepare();
    await s.t.run(async (ctx) => {
      const changed = (await ctx.db.get(s.sourceIds[1]!))!;
      await ctx.db.patch(changed._id, await writeDocumentText(ctx, changed, "A different text now."));
      await deleteDocumentText(ctx, s.sourceIds[2]!);
      await ctx.db.delete(s.sourceIds[2]!);
    });
    await completeProjectCopy(s.t, plan);
    const byName = new Map((await s.copies()).map((copy) => [copy.fileName, copy]));
    expect(byName.get("notes-0.txt")?.textCopyState).toBeUndefined();
    expect(await textOf(s, byName.get("notes-0.txt")!._id)).toBe("Kept the same.");
    for (const name of ["notes-1.txt", "notes-2.txt"]) {
      expect(byName.get(name)).toMatchObject({ textCopyState: "failed", hasText: false, textLength: 0, processingStatus: "could_not_read" });
    }
    const listed = await s.writer.query(api.documents.listDocuments, { projectId: s.toProjectId });
    expect(listed.filter((row) => row.copyState === "could_not_copy")).toHaveLength(2);
    expect(await s.job(plan.jobId)).toMatchObject({ status: "done", filesCopied: 1, filesFailed: 2 });
    expect(await s.t.run((ctx) => projectCopyInProgress(ctx, s.toProjectId))).toBe(false);
  });

  it("leaves a file replaced while it was pending as the writer replaced it", async () => {
    const s = await setup([{ text: "Copied text." }]);
    const plan = await s.prepare();
    const [copy] = await s.copies();
    await s.t.run(async (ctx) => {
      const row = (await ctx.db.get(copy!._id))!;
      await ctx.db.patch(row._id, await writeDocumentText(ctx, row, "The writer's own text."));
    });
    await completeProjectCopy(s.t, plan);
    expect((await s.copies())[0]?.textCopyState).toBeUndefined();
    expect(await textOf(s, copy!._id)).toBe("The writer's own text.");
    expect(await s.job(plan.jobId)).toMatchObject({ status: "done", filesCopied: 0, filesFailed: 0 });
  });

  it("gives up the original project's files when that project is erased mid-copy", async () => {
    const s = await setup([{ text: "One." }, { text: "Two." }]);
    const plan = await s.prepare();
    await copyNext(s, plan);
    await s.writer.mutation(api.projects.deleteProject, { projectId: s.fromProjectId });
    await completeProjectCopy(s.t, plan);
    const states = (await s.copies()).map((copy) => copy.textCopyState ?? "copied").sort();
    expect(states).toEqual(["copied", "failed"]);
    expect(await s.job(plan.jobId)).toMatchObject({ status: "done" });
  });

  describe("with the scheduler", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("finishes a copy whose runner stopped after file 10, under a new lease; the old runner's steps are refused", async () => {
      const s = await setup(Array.from({ length: 15 }, (_, index) => ({ text: `Seal note ${index}.`, original: true })));
      const plan = await s.prepare();
      for (let file = 0; file < 10; file += 1) expect((await copyNext(s, plan, true))?.outcome).toBe("copied");
      // The runner crashed: its lease runs out and the cron takes the job up.
      await s.t.run((ctx) => ctx.db.patch(plan.jobId, { leaseUntil: Date.now() - 1 }));
      expect(await s.t.mutation(internal.projectDuplication.resumeStalledProjectCopies, {})).toBe(1);
      // The old lease no longer works: no file is offered, and a step is
      // refused with its clone released.
      expect(await s.t.query(internal.projects.nextProjectCopyFile, { jobId: plan.jobId, leaseToken: plan.leaseToken })).toBeNull();
      const pending = (await s.copies()).find((copy) => copy.textCopyState === "pending")!;
      const before = await s.storedFiles();
      const clone = await s.t.run((ctx) => ctx.storage.store(new Blob(["late clone"])));
      expect(
        await s.t.mutation(internal.projects.copyProjectFile, {
          jobId: plan.jobId, leaseToken: plan.leaseToken, documentId: pending._id, cloneStorageId: clone,
        })
      ).toBe("stopped");
      expect(await s.storedFiles()).toEqual(before);
      await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const copies = await s.copies();
      expect(copies.every((copy) => copy.textCopyState === undefined && copy.storageId !== undefined)).toBe(true);
      expect(await s.job(plan.jobId)).toMatchObject({ status: "done", filesCopied: 15, resumes: 1 });
    });

    it("stops when the new project is erased mid-copy: nothing is written after, and clones are released", async () => {
      const s = await setup([{ text: "One.", original: true }, { text: "Two.", original: true }, { text: "Three.", original: true }]);
      const plan = await s.prepare();
      const first = await copyNext(s, plan, true);
      expect(first?.outcome).toBe("copied");
      await s.writer.mutation(api.projects.deleteProject, { projectId: s.toProjectId });
      const stored = await s.storedFiles();
      const second = await copyNext(s, plan, true);
      // The query still finds a file, but the step stops and releases its clone.
      expect(second?.outcome).toBe("stopped");
      expect(await s.storedFiles()).toEqual(stored);
      expect(await s.job(plan.jobId)).toMatchObject({ status: "failed", stopReason: "new_project_erased" });
      const unwritten = await s.t.run(async (ctx) => {
        const pieces = [];
        for (const copy of await ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", s.toProjectId)).collect()) {
          if (copy._id === first!.documentId) continue;
          pieces.push(...(await ctx.db.query("projectDocumentTexts").withIndex("by_documentId_and_start", (q) => q.eq("documentId", copy._id)).collect()));
        }
        return pieces;
      });
      expect(unwritten).toEqual([]);
      // The erasure then removes the job and the clone the first file got.
      await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(await s.job(plan.jobId)).toBeNull();
      expect(await s.storedFiles()).not.toContain(first!.clone);
      expect((await s.storedFiles()).length).toBe(3);
    });
  });
});
