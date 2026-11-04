/// <reference types="vite/client" />
import { drainScheduledFunctions } from "./testScheduledFunctions";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deleteDocumentText, insertDocumentWithText, readDocumentText, writeDocumentText } from "./lib/documentText";
import {
  PROJECT_STILL_COPYING_MESSAGE,
  REVIEW_STOPPED_WHILE_COPYING_MESSAGE,
  SOURCE_STILL_COPYING_MESSAGE,
  projectCopyInProgress,
  reconcileCopyClones,
} from "./lib/projectCopy";
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
  files: Array<{ text: string; older?: boolean; original?: boolean | (() => Blob); category?: "other" | "background" }>,
  options: { transactionLimits?: boolean } = {}
) {
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
  rateLimiterTest.register(t);
  const now = Date.now() - 10_000;
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "writer", name: "Wren Writer" });
    const project = { clientName: "Quillmere Seals", status: "draft" as const, createdBy: userId, ownerId: userId, createdAt: now, updatedAt: now };
    const fromProjectId = await ctx.db.insert("projects", { ...project, title: "Seals", shareToken: "copy-from" });
    const toProjectId = await ctx.db.insert("projects", { ...project, title: "Seals (copy)", shareToken: "copy-to" });
    const thirdProjectId = await ctx.db.insert("projects", { ...project, title: "Seals (copy of the copy)", shareToken: "copy-third" });
    return { userId, fromProjectId, toProjectId, thirdProjectId };
  });
  const sourceIds: Id<"projectDocuments">[] = [];
  for (const [index, file] of files.entries()) {
    sourceIds.push(
      await t.run(async (ctx) => {
        const storageId = file.original
          ? await ctx.storage.store(typeof file.original === "function" ? file.original() : new Blob([`original ${index}`]))
          : undefined;
        const fields = {
          projectId: ids.fromProjectId,
          fileName: `notes-${index}.txt`,
          fileType: "txt" as const,
          category: file.category ?? ("other" as const),
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
  const prepare = (from = ids.fromProjectId, to = ids.toProjectId) =>
    writer.mutation(internal.projects.prepareProjectContentCopy, {
      fromProjectId: from,
      toProjectId: to,
      requireFreshTarget: true,
    });
  const copies = (projectId = ids.toProjectId) =>
    t.run((ctx) =>
      ctx.db.query("projectDocuments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect()
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
    expect(result).toMatchObject({ originalsNotCopied: 0, filesNotCopied: [] });
    expect(result.stillCopying).toBeUndefined();
    expect(result.documents.map((row) => row.sourceId)).toEqual(s.sourceIds);
    const copies = await s.copies();
    expect(copies).toHaveLength(60);
    // Every pair is a source file and the row it became, each row once.
    expect(result.documents).toEqual(copies.map((copy) => ({ sourceId: copy.copiedFromDocumentId, documentId: copy._id })));
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
    // The same draft request now goes through (its run is never started here).
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    try {
      const generationId = await s.writer.mutation(api.generations.requestGeneration, {
        projectId: s.toProjectId,
        candidateMode: "iterative",
      });
      expect(await s.t.run((ctx) => ctx.db.get(generationId))).toMatchObject({ status: "reserved" });
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
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
    // Greptile review (2026-11-02): the copy's result names both, so the wizard starts nothing.
    const outcome = await s.t.query(internal.projects.projectCopyOutcome, { jobId: plan.jobId });
    expect(outcome?.filesNotCopied.map((file) => [file.fileName, file.documentId])).toEqual([
      ["notes-1.txt", byName.get("notes-1.txt")!._id],
      ["notes-2.txt", byName.get("notes-2.txt")!._id],
    ]);
    expect(outcome?.documents).toHaveLength(3);
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

  it("gives up the original project's files when that project is erased mid-copy, and keeps the copy", async () => {
    vi.useFakeTimers();
    try {
      const s = await setup([{ text: "One." }, { text: "Two." }]);
      const plan = await s.prepare();
      await copyNext(s, plan);
      await s.writer.mutation(api.projects.deleteProject, { projectId: s.fromProjectId });
      // The erasure runs to its end: the job's reference to the original is cleared.
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect(await s.t.run((ctx) => ctx.db.get(s.fromProjectId))).toBeNull();
      expect((await s.job(plan.jobId))?.fromProjectId).toBeUndefined();
      await completeProjectCopy(s.t, plan);
      const states = (await s.copies()).map((copy) => copy.textCopyState ?? "copied").sort();
      expect(states).toEqual(["copied", "failed"]);
      expect(await s.job(plan.jobId)).toMatchObject({ status: "done", filesCopied: 1, filesFailed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to copy a project still being copied into, and keeps a file that could not be copied so in a copy of the copy", async () => {
    const s = await setup([{ text: "Kept." }, { text: "Changed meanwhile." }]);
    const plan = await s.prepare();
    await expect(s.prepare(s.toProjectId, s.thirdProjectId)).rejects.toThrow(SOURCE_STILL_COPYING_MESSAGE);
    await s.t.run(async (ctx) => {
      const changed = (await ctx.db.get(s.sourceIds[1]!))!;
      await ctx.db.patch(changed._id, await writeDocumentText(ctx, changed, "Something else."));
    });
    await completeProjectCopy(s.t, plan);
    const second = await s.prepare(s.toProjectId, s.thirdProjectId);
    await completeProjectCopy(s.t, second);
    const states = (await s.copies(s.thirdProjectId)).map((copy) => [copy.fileName, copy.textCopyState ?? "copied"]);
    expect(states).toEqual([["notes-0.txt", "copied"], ["notes-1.txt", "failed"]]);
    expect(await s.job(second.jobId)).toMatchObject({ status: "done", filesCopied: 1 });
    // Greptile review (2026-11-02): named from the rows, though the job counted no failure.
    const outcome = await s.t.query(internal.projects.projectCopyOutcome, { jobId: second.jobId });
    expect(outcome?.filesNotCopied.map((file) => file.fileName)).toEqual(["notes-1.txt"]);
  });

  it("checks a long leave-out list of large older files page by page, within Convex's limits, and refuses a file from another project", async () => {
    // 50 older rows of 400,000 characters: reading them all at once would
    // pass a transaction's 16 MiB.
    const s = await setup(
      [
        ...Array.from({ length: 50 }, (_, index) => ({ text: words(index, 400_000), older: true })),
        { text: "Kept one." },
        { text: "Kept two." },
      ],
      { transactionLimits: true }
    );
    const foreign = await s.t.run(async (ctx) =>
      insertDocumentWithText(ctx, {
        projectId: s.thirdProjectId, fileName: "elsewhere.txt", fileType: "txt", source: "context_input",
        uploadedBy: "Wren Writer", processingStatus: "ready", createdAt: 1,
      }, "Another project's file.")
    );
    const leftOut = s.sourceIds.slice(0, 50);
    await expect(
      s.writer.action(api.projectDuplication.copyProjectContent, {
        fromProjectId: s.fromProjectId, toProjectId: s.toProjectId, excludeDocumentIds: [...leftOut, foreign],
      })
    ).rejects.toThrow("A file to leave out is not in the original project");
    // Nothing was started.
    expect(await s.copies()).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.query("projectCopyJobs").collect())).toEqual([]);
    const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: s.fromProjectId, toProjectId: s.toProjectId, excludeDocumentIds: leftOut,
    });
    expect(result.documents.map((row) => row.sourceId)).toEqual(s.sourceIds.slice(50));
  });

  it("refuses to start or retry a PD review while files are being copied, and holds a review already started", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    try {
      const s = await setup([{ text: "Written PD text.", category: "background" }, { text: "Support notes.", category: "background" }]);
      await s.prepare();
      const [pd] = await s.copies();
      await expect(
        s.writer.mutation(api.pdReviews.startPdReview, { projectId: s.toProjectId, documentId: pd!._id })
      ).rejects.toThrow(PROJECT_STILL_COPYING_MESSAGE);
      const reviewId = await s.t.run((ctx) =>
        ctx.db.insert("pdReviews", {
          projectId: s.toProjectId, documentId: pd!._id, sourceFileName: pd!.fileName, status: "running",
          createdBy: s.userId, createdAt: Date.now(),
        })
      );
      // The written PD itself has no text yet.
      await expect(s.t.query(internal.pdReviews.getReviewInput, { reviewId })).rejects.toThrow(PROJECT_STILL_COPYING_MESSAGE);
      // Nor does a review of a PD of the project's own, while support files are on their way.
      const ownPd = await s.t.run((ctx) =>
        insertDocumentWithText(ctx, {
          projectId: s.toProjectId, fileName: "own-pd.txt", fileType: "txt", source: "review_pd",
          uploadedBy: "Wren Writer", processingStatus: "ready", createdAt: Date.now(),
        }, "The writer's own PD.")
      );
      const ownReviewId = await s.t.run((ctx) =>
        ctx.db.insert("pdReviews", {
          projectId: s.toProjectId, documentId: ownPd, sourceFileName: "own-pd.txt", status: "running",
          createdBy: s.userId, createdAt: Date.now(),
        })
      );
      await expect(s.t.query(internal.pdReviews.getReviewInput, { reviewId: ownReviewId })).rejects.toThrow(PROJECT_STILL_COPYING_MESSAGE);
      // At its longest wait, a review still waiting stops, to be run again; it never runs without the files.
      await s.t.action(internal.ai.reviewAgent.runPdReview, { reviewId: ownReviewId, projectId: s.toProjectId, copyWaits: 60 });
      expect(await s.t.run((ctx) => ctx.db.get(ownReviewId))).toMatchObject({
        status: "failed",
        error: REVIEW_STOPPED_WHILE_COPYING_MESSAGE,
      });
      // A review already started waits, looking again in ten seconds.
      await s.t.action(internal.ai.reviewAgent.runPdReview, { reviewId, projectId: s.toProjectId });
      const scheduled = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.filter((job) => job.name === "ai/reviewAgent:runPdReview")).toEqual([
        expect.objectContaining({ args: [{ reviewId, projectId: s.toProjectId, copyWaits: 1 }] }),
      ]);
      await s.t.run((ctx) => ctx.db.patch(reviewId, { status: "failed" }));
      await expect(s.writer.mutation(api.pdReviews.retryPdReview, { reviewId })).rejects.toThrow(PROJECT_STILL_COPYING_MESSAGE);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it("gives up a file whose copy step fails twice, so it never holds up the rest", async () => {
    const s = await setup([{ text: "One." }, { text: "Two." }]);
    const plan = await s.prepare();
    const lease = { jobId: plan.jobId, leaseToken: plan.leaseToken };
    const next = (await s.t.query(internal.projects.nextProjectCopyFile, lease))!;
    expect(await s.t.mutation(internal.projects.noteProjectCopyFileError, { ...lease, documentId: next.documentId })).toBe("retry");
    expect(await s.t.mutation(internal.projects.noteProjectCopyFileError, { ...lease, documentId: next.documentId })).toBe("failed");
    expect(await s.t.run((ctx) => ctx.db.get(next.documentId))).toMatchObject({ textCopyState: "failed", textCopyAttempts: 2 });
    await completeProjectCopy(s.t, plan);
    expect(await s.job(plan.jobId)).toMatchObject({ status: "done", filesCopied: 1, filesFailed: 1 });
  });

  it("copies a file without an original that cannot be read twice, and says so in the result", async () => {
    let reads = 0;
    class UnreadableAfterStore extends Blob {
      override async arrayBuffer() {
        reads += 1;
        if (reads > 1) throw new Error("storage read failed");
        return await super.arrayBuffer();
      }
    }
    const s = await setup([{ text: "Notes with a broken original.", original: () => new UnreadableAfterStore(["bytes"]) }]);
    const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: s.fromProjectId, toProjectId: s.toProjectId,
    });
    expect(reads).toBe(3);
    // An unreadable original leaves the file's text copied: it is not "could not copy".
    expect(result).toMatchObject({ documentsCopied: 1, filesCopied: 0, originalsNotCopied: 1, filesNotCopied: [] });
    const [copy] = await s.copies();
    expect(copy?.storageId).toBeUndefined();
    expect(await textOf(s, copy!._id)).toBe("Notes with a broken original.");
  });

  it("waits for the runner that took the copy over, and returns that runner's work from what was written", async () => {
    let reads = 0;
    let cloning: () => void = () => undefined;
    const firstClone = new Promise<void>((resolve) => (cloning = resolve));
    class TakenOverOnClone extends Blob {
      override async arrayBuffer() {
        reads += 1;
        // The first clone: the test takes the job over meanwhile (as the
        // cron does when a runner stalls), before the clone's step runs.
        if (reads === 2) cloning();
        return await super.arrayBuffer();
      }
    }
    const s = await setup([
      { text: "First.", original: () => new TakenOverOnClone(["bytes"]) },
      { text: "Second." },
      { text: "Third." },
    ]);
    const running = s.writer.action(api.projectDuplication.copyProjectContent, {
      fromProjectId: s.fromProjectId, toProjectId: s.toProjectId,
    });
    await firstClone;
    const jobId = await s.t.run(async (ctx) => {
      const row = (await ctx.db.query("projectCopyJobs").first())!;
      await ctx.db.patch(row._id, { leaseToken: "other runner", leaseUntil: Date.now() + 60_000 });
      return row._id;
    });
    // The other runner finishes the copy while the action waits.
    await completeProjectCopy(s.t, { jobId, leaseToken: "other runner" });
    const result = await running;
    expect(result.stillCopying).toBeUndefined();
    expect(result.documentsCopied).toBe(3);
    expect(result.documents.map((row) => row.sourceId)).toEqual(s.sourceIds);
    expect((await s.copies()).every((copy) => copy.textCopyState === undefined)).toBe(true);
    // The action's own clone was released when its step found the lease gone.
    expect((await s.copies())[0]?.storageId).toBeUndefined();
    expect(await s.storedFiles()).toHaveLength(1);
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
      ).toBe("lease_lost");
      expect(await s.storedFiles()).toEqual(before);
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
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
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect(await s.job(plan.jobId)).toBeNull();
      expect(await s.storedFiles()).not.toContain(first!.clone);
      expect((await s.storedFiles()).length).toBe(3);
    });

    it("hands a copy too long for the first action to a fresh runner: the result says it is still copying, and the job finishes it", async () => {
      let reads = 0;
      class SlowClone extends Blob {
        override async arrayBuffer() {
          reads += 1;
          // The first clone takes the action past its time.
          if (reads === 2) vi.setSystemTime(Date.now() + 8 * 60 * 1000);
          return await super.arrayBuffer();
        }
      }
      const s = await setup([
        { text: "First.", original: () => new SlowClone(["bytes"]) },
        { text: "Second." },
        { text: "Third." },
      ]);
      const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
        fromProjectId: s.fromProjectId, toProjectId: s.toProjectId,
      });
      expect(result.stillCopying).toBe(true);
      // The rows were all made: the receipt is whole.
      expect(result.documents.map((row) => row.sourceId)).toEqual(s.sourceIds);
      expect((await s.copies()).filter((copy) => copy.textCopyState === "pending")).toHaveLength(2);
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect((await s.copies()).every((copy) => copy.textCopyState === undefined)).toBe(true);
      const [job] = await s.t.run((ctx) => ctx.db.query("projectCopyJobs").collect());
      expect(job).toMatchObject({ status: "done", filesCopied: 3, originalsAttached: 1 });
    });

    it("a runner that dies mid-clone: the cron takes the copy up under a new lease, the next runner copies the file, and the stray clone is tracked and later removed", async () => {
      const s = await setup([{ text: "One.", original: true }, { text: "Two.", original: true }]);
      const plan = await s.prepare();
      const lease = { jobId: plan.jobId, leaseToken: plan.leaseToken };
      const next = (await s.t.query(internal.projects.nextProjectCopyFile, lease))!;
      const record = await s.t.mutation(internal.projects.beginProjectCopyClone, { ...lease, sourceStorageId: next.sourceStorageId! });
      expect(record).not.toBeNull();
      // The runner stores the clone, then its action ends before attaching it.
      const stray = await s.t.run(async (ctx) => ctx.storage.store((await ctx.storage.get(next.sourceStorageId!))!));
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toHaveLength(1);
      // Not yet: a save could still attach a file made in the record's window.
      // Recovery takes the job up; the cleanup runs on its own.
      vi.setSystemTime(Date.now() + 30 * 60 * 1000);
      await s.t.mutation(internal.projectDuplication.resumeStalledProjectCopies, {});
      await s.t.mutation(internal.projectDuplication.reconcileProjectCopyClones, {});
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect(await s.job(plan.jobId)).toMatchObject({ status: "done", resumes: 1, filesCopied: 2, originalsAttached: 2 });
      // The stray clone is still tracked, and kept while a save could attach it.
      expect(await s.storedFiles()).toContain(stray);
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toHaveLength(1);
      // Its whole window is past an hour old: the stray clone goes, the files each have their own.
      vi.setSystemTime(Date.now() + 55 * 60 * 1000);
      expect(await s.t.mutation(internal.projectDuplication.reconcileProjectCopyClones, {})).toBe(1);
      expect(await s.storedFiles()).not.toContain(stray);
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toEqual([]);
      const copies = await s.copies();
      expect(copies.every((copy) => copy.textCopyState === undefined && copy.storageId !== undefined)).toBe(true);
      // Two originals and two attached clones; nothing else.
      expect(new Set(await s.storedFiles())).toEqual(
        new Set([...copies.map((copy) => copy.storageId!), ...(await s.t.run(async (ctx) =>
          Promise.all(s.sourceIds.map(async (id) => (await ctx.db.get(id))!.storageId!))))])
      );
    });

    it("leaves a matching file in a clone record's window until all of the window is too old to attach, then reads the window a page at a time", async () => {
      const s = await setup([{ text: "notes", original: true }]);
      const plan = await s.prepare();
      const source = (await s.t.run((ctx) => ctx.db.get(s.sourceIds[0]!)))!;
      vi.setSystemTime(Date.now() + 1_000);
      const start = Date.now();
      await s.t.mutation(internal.projects.beginProjectCopyClone, {
        jobId: plan.jobId, leaseToken: plan.leaseToken, sourceStorageId: source.storageId!,
      });
      // 500 other files, then, 14 minutes on, an unrelated upload of the same bytes.
      for (let index = 0; index < 500; index += 1) {
        await s.t.run((ctx) => ctx.storage.store(new Blob([`other ${index}`])));
      }
      vi.setSystemTime(start + 14 * 60 * 1000);
      const upload = await s.t.run(async (ctx) => ctx.storage.store((await ctx.storage.get(source.storageId!))!));
      // 66 minutes on, the upload is 52 minutes old: a save could still attach it.
      vi.setSystemTime(start + 66 * 60 * 1000);
      expect(await s.t.run((ctx) => reconcileCopyClones(ctx))).toEqual({ deleted: 0, more: false });
      expect(await s.storedFiles()).toContain(upload);
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toHaveLength(1);
      // 81 minutes on, all of the window is past an hour old: past the 500
      // other files, a page at a time, the match goes.
      vi.setSystemTime(start + 81 * 60 * 1000);
      expect(await s.t.run((ctx) => reconcileCopyClones(ctx))).toEqual({ deleted: 1, more: false });
      expect(await s.storedFiles()).not.toContain(upload);
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toEqual([]);
      // The original itself is held by its file and stays.
      expect(await s.storedFiles()).toContain(source.storageId);
    });

    it("deletes 500 stray clones within Convex's limits: a run keeps its place before any limit and goes on in a fresh one", async () => {
      const s = await setup([{ text: "notes", original: true }], { transactionLimits: true });
      const plan = await s.prepare();
      const source = (await s.t.run((ctx) => ctx.db.get(s.sourceIds[0]!)))!;
      vi.setSystemTime(Date.now() + 1_000);
      await s.t.mutation(internal.projects.beginProjectCopyClone, {
        jobId: plan.jobId, leaseToken: plan.leaseToken, sourceStorageId: source.storageId!,
      });
      // Each match costs nine index reads: 500 of them pass one transaction's 4,096.
      const strays: Id<"_storage">[] = [];
      for (let index = 0; index < 500; index += 1) {
        strays.push(await s.t.run(async (ctx) => ctx.storage.store((await ctx.storage.get(source.storageId!))!)));
      }
      vi.setSystemTime(Date.now() + 81 * 60 * 1000);
      const first = await s.t.mutation(internal.projectDuplication.reconcileProjectCopyClones, {});
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(500);
      expect((await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect()))[0]?.scannedThrough).toBeTypeOf("number");
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      const stored = await s.storedFiles();
      expect(strays.filter((id) => stored.includes(id))).toEqual([]);
      expect(stored).toContain(source.storageId);
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toEqual([]);
    });

    it("reads two overlapping windows of 31,799 other files within Convex's limits, checking before every page", async () => {
      const s = await setup([{ text: "notes", original: true }], { transactionLimits: true });
      const plan = await s.prepare();
      const source = (await s.t.run((ctx) => ctx.db.get(s.sourceIds[0]!)))!;
      vi.setSystemTime(Date.now() + 1_000);
      const start = Date.now();
      for (let index = 0; index < 2; index += 1) {
        await s.t.mutation(internal.projects.beginProjectCopyClone, {
          jobId: plan.jobId, leaseToken: plan.leaseToken, sourceStorageId: source.storageId!,
        });
      }
      for (let batch = 0; batch < 318; batch += 1) {
        await s.t.run(async (ctx) => {
          for (let index = 0; index < (batch === 317 ? 99 : 100); index += 1) await ctx.storage.store(new Blob(["other"]));
        });
      }
      vi.setSystemTime(start + 81 * 60 * 1000);
      // The first run reads all of one window, then stops before the
      // second's first page would pass the 32,000 rows read: its progress
      // (one record done) is kept, and a fresh run goes on.
      expect(await s.t.mutation(internal.projectDuplication.reconcileProjectCopyClones, {})).toBe(0);
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toHaveLength(1);
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect(await s.t.run((ctx) => ctx.db.query("projectCopyClones").collect())).toEqual([]);
    }, 120_000);

    it("hands the copy on rather than try a failed clone again without time for it", async () => {
      let reads = 0;
      class FailsLateOnce extends Blob {
        override async arrayBuffer() {
          reads += 1;
          // The first clone fails after 5 minutes: 2 of the 7 are left.
          if (reads === 2) {
            vi.setSystemTime(Date.now() + 5 * 60 * 1000);
            throw new Error("storage read failed");
          }
          return await super.arrayBuffer();
        }
      }
      const s = await setup([{ text: "Notes.", original: () => new FailsLateOnce(["bytes"]) }]);
      const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
        fromProjectId: s.fromProjectId, toProjectId: s.toProjectId,
      });
      expect(result).toMatchObject({ stillCopying: true, originalsNotCopied: 0 });
      expect((await s.copies())[0]?.textCopyState).toBe("pending");
      // The next runner clones it.
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect((await s.copies())[0]?.storageId).toBeDefined();
      const [job] = await s.t.run((ctx) => ctx.db.query("projectCopyJobs").collect());
      expect(job).toMatchObject({ status: "done", originalsAttached: 1 });
      expect(job?.originalsNotCopied ?? 0).toBe(0);
    });

    it("attaches transcript originals one at a time, handing the copy on when its time runs out between them", async () => {
      let slow = false;
      class SlowTranscript extends Blob {
        override async arrayBuffer() {
          if (slow) vi.setSystemTime(Date.now() + 6 * 60 * 1000);
          return await super.arrayBuffer();
        }
      }
      const s = await setup([]);
      const copied: Id<"transcripts">[] = [];
      for (let index = 0; index < 2; index += 1) {
        copied.push(
          await s.t.run(async (ctx) => {
            const originalStorageId = await ctx.storage.store(new SlowTranscript([`transcript ${index}`]));
            const source = await ctx.db.insert("transcripts", {
              projectId: s.fromProjectId, content: `Interview ${index}.`, contentHash: `hash-${index}`, createdAt: Date.now() + index, originalStorageId,
            });
            return await ctx.db.insert("transcripts", {
              projectId: s.toProjectId, content: `Interview ${index}.`, contentHash: `hash-${index}`, createdAt: Date.now() + index, copiedFromTranscriptId: source,
            });
          })
        );
      }
      slow = true;
      const started = Date.now();
      const result = await s.writer.action(api.projectDuplication.copyProjectContent, {
        fromProjectId: s.fromProjectId, toProjectId: s.toProjectId,
      });
      // The first clone took 6 minutes; with 1 minute left of the 7, the
      // second is not started: the action ends well inside its 10 minutes.
      expect(result).toMatchObject({ stillCopying: true, transcriptOriginalsCopied: 1 });
      expect(Date.now() - started).toBe(6 * 60 * 1000);
      slow = false;
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      const rows = await s.t.run(async (ctx) => Promise.all(copied.map((id) => ctx.db.get(id))));
      expect(rows.every((row) => row?.originalStorageId !== undefined)).toBe(true);
      const [job] = await s.t.run((ctx) => ctx.db.query("projectCopyJobs").collect());
      expect(job).toMatchObject({ status: "done", transcriptOriginalsAttached: 2 });
    });

    it("gives a job up after it stalled 20 times: its files could not be copied, and drafts may start", async () => {
      const s = await setup([{ text: "One." }, { text: "Two." }]);
      const plan = await s.prepare();
      await s.t.run((ctx) => ctx.db.patch(plan.jobId, { resumes: 20, leaseUntil: Date.now() - 1 }));
      expect(await s.t.mutation(internal.projectDuplication.resumeStalledProjectCopies, {})).toBe(0);
      expect(await s.job(plan.jobId)).toMatchObject({ status: "failed", stopReason: "stalled" });
      expect((await s.copies()).map((copy) => copy.textCopyState)).toEqual(["failed", "failed"]);
      expect(await s.t.run((ctx) => projectCopyInProgress(ctx, s.toProjectId))).toBe(false);
    });

    it("stops when the copier's access ends, marking all 150 pending files, a page at a time", async () => {
      const s = await setup(Array.from({ length: 150 }, (_, index) => ({ text: `Note ${index}.` })));
      const plan = await s.prepare();
      expect(plan.prepared).toBe(true);
      await s.t.run((ctx) => ctx.db.patch(s.userId, { role: undefined }));
      const lease = { jobId: plan.jobId, leaseToken: plan.leaseToken };
      const next = (await s.t.query(internal.projects.nextProjectCopyFile, lease))!;
      expect(await s.t.mutation(internal.projects.copyProjectFile, { ...lease, documentId: next.documentId })).toBe("stopped");
      expect(await s.job(plan.jobId)).toMatchObject({ status: "failed", stopReason: "copier_access_ended" });
      expect((await s.copies()).filter((copy) => copy.textCopyState === "failed")).toHaveLength(100);
      await drainScheduledFunctions(s.t, () => vi.runAllTimers());
      expect((await s.copies()).filter((copy) => copy.textCopyState === "failed")).toHaveLength(150);
    });
  });
});
