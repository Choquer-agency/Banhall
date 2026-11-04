/**
 * F2 (2026-10-27, `docs/todos/phase-f-scale.md`): a project copy, file by
 * file. The duplicate wizard and review from project make the new project's
 * rows first (`projects.prepareProjectContentCopy`): each file's row holds
 * the facts about its text (length, fingerprint, preview) and no text,
 * marked "pending". Each file's text is then copied whole in its own
 * transaction (`copyPendingFile`), so a project with many large files no
 * longer passes one transaction's limits.
 *
 * The action that started the copy waits for every file. Only after a crash
 * is a file left pending: the job continues itself under its lease, and a
 * cron takes up a stalled job. While any file is pending, a draft is refused
 * by name (`PROJECT_STILL_COPYING_MESSAGE`), and search pieces, server
 * reading, file labels and the text move leave the file alone.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { sha256 } from "./contracts";
import { deriveStoredProcessing } from "../../shared/documentStatus";
import {
  DocumentTextIncompleteError,
  documentTextFacts,
  readDocumentText,
  writeDocumentText,
} from "./documentText";
import { hasReadText, queueServerReadingIfNeeded } from "./serverReading";
import { FRESH_UPLOAD_MS, isStorageReferenced, uploadClaimFor } from "./storage";

/** How long a runner holds a job between steps; every step renews it. */
export const PROJECT_COPY_LEASE_MS = 2 * 60 * 1000;
/** Times a stalled job is taken up again before its remaining files are given up. */
export const PROJECT_COPY_MAX_RESUMES = 20;
/** Pending files marked "could not copy" per transaction when a job stops. */
const FAIL_PAGE = 100;

/**
 * A draft started while the project's files are still being copied would
 * read some of them and not others. This is a new rule on starting a draft
 * (decision entry "2026-10-27 (eighth)", owner question 3 pending).
 */
export const PROJECT_STILL_COPYING_MESSAGE =
  "This project's files are still being copied. Try again in a minute.";

/** A review that waited its longest for its project's files (F2 review, round 2). */
export const REVIEW_STOPPED_WHILE_COPYING_MESSAGE =
  "This project's files were still being copied, so the review stopped. Run it again in a minute.";

/** A project still being copied into cannot be copied from (F2 review): its files have no text yet. */
export const SOURCE_STILL_COPYING_MESSAGE =
  "The project you are copying is still having its own files copied. Try again in a minute.";

/** Failed copy steps of one file before it is given up (F2 review). */
export const MAX_FILE_COPY_ATTEMPTS = 2;

type Ctx = { db: QueryCtx["db"] };

/** Whether any of the project's files is still being copied, or its copy is still making rows. */
export async function projectCopyInProgress(ctx: Ctx, projectId: Id<"projects">): Promise<boolean> {
  for (const status of ["preparing", "copying"] as const) {
    const job = await ctx.db
      .query("projectCopyJobs")
      .withIndex("by_toProjectId_and_status", (q) => q.eq("toProjectId", projectId).eq("status", status))
      .first();
    if (job) return true;
  }
  const pending = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId_and_textCopyState", (q) => q.eq("projectId", projectId).eq("textCopyState", "pending"))
    .first();
  return pending !== null;
}

/** Whether a file's text is still being copied (its row holds no text yet). */
export function textCopyPending(doc: Pick<Doc<"projectDocuments">, "textCopyState">): boolean {
  return doc.textCopyState === "pending";
}

/** The same eligibility as `requireInternalActor`, for a step that runs without the copier's identity. */
export function copierAllowed(user: Doc<"users"> | null): user is Doc<"users"> {
  return user !== null && user.isAnonymous !== true && user.role !== undefined;
}

/**
 * Marks a file "could not copy": its row then holds no text (so no draft,
 * search or chat reads it) and the original's clone, if one was made, is
 * released.
 */
export async function failCopiedFile(
  ctx: MutationCtx,
  doc: Doc<"projectDocuments">,
  clone?: Id<"_storage">
): Promise<void> {
  if (clone) await ctx.storage.delete(clone);
  await ctx.db.patch(doc._id, {
    ...(await documentTextFacts("")),
    textMovedAt: Date.now(),
    textCopyState: "failed",
    textCopyJobId: undefined,
    processingStatus: "could_not_read",
    processingDetail: undefined,
    searchPiecesDue: undefined,
    searchPiecesNextAt: undefined,
  });
}

/**
 * Copies one pending file's text whole, after checking again that the
 * original project and file still exist and that the file's text is the
 * text whose fingerprint and length the row recorded when it was made.
 * Writes the text, clears the mark, attaches the original's clone (made by
 * the action) and sets the file's search pieces due. Anything else marks it
 * "could not copy" and releases the clone.
 */
export async function copyPendingFile(
  ctx: MutationCtx,
  job: Doc<"projectCopyJobs">,
  doc: Doc<"projectDocuments">,
  clone?: Id<"_storage">
): Promise<"copied" | "failed"> {
  const fail = async () => {
    await failCopiedFile(ctx, doc, clone);
    return "failed" as const;
  };
  const sourceProject = job.fromProjectId ? await ctx.db.get(job.fromProjectId) : null;
  if (!sourceProject || sourceProject.deletionStartedAt !== undefined) return await fail();
  const source = doc.copiedFromDocumentId ? await ctx.db.get(doc.copiedFromDocumentId) : null;
  if (!source || source.projectId !== sourceProject._id) return await fail();
  let text: string;
  try {
    text = await readDocumentText(ctx, source);
  } catch (error) {
    if (error instanceof DocumentTextIncompleteError) return await fail();
    throw error;
  }
  if (text.length !== doc.textLength || (await sha256(text)) !== doc.textHash) return await fail();
  const fields = await writeDocumentText(ctx, doc, text, Date.now(), { storedText: true });
  const processing = doc.processingStatus
    ? {}
    : (() => {
        const derived = deriveStoredProcessing({ fileName: doc.fileName, content: text });
        return { processingStatus: derived.status, ...(derived.detail ? { processingDetail: derived.detail } : {}) };
      })();
  await ctx.db.patch(doc._id, {
    ...fields,
    // Like a new file: an empty text has nothing to search.
    ...(text.trim() ? {} : { searchPiecesDue: undefined, searchPiecesNextAt: undefined }),
    ...processing,
    textCopyState: undefined,
    textCopyJobId: undefined,
    ...(clone ? { storageId: clone } : {}),
  });
  // 2026-10-26 (Phase B2): a copied file with nothing read is read once its
  // own original arrives.
  if (clone) {
    await queueServerReadingIfNeeded(ctx, doc._id, { ...doc, storageId: clone }, hasReadText(text));
  }
  return "copied";
}

/**
 * A copy step of this file failed with an error (F2 review): counted, and
 * at MAX_FILE_COPY_ATTEMPTS the file is given up, so one bad file never
 * holds up the rest of the copy.
 */
export async function noteFileCopyError(ctx: MutationCtx, doc: Doc<"projectDocuments">): Promise<"retry" | "failed"> {
  const attempts = (doc.textCopyAttempts ?? 0) + 1;
  if (attempts >= MAX_FILE_COPY_ATTEMPTS) {
    await failCopiedFile(ctx, doc);
    await ctx.db.patch(doc._id, { textCopyAttempts: attempts });
    return "failed";
  }
  await ctx.db.patch(doc._id, { textCopyAttempts: attempts });
  return "retry";
}

/** How long after its record a clone can have been stored: an action runs at most 10 minutes. */
const CLONE_WINDOW_MS = 15 * 60 * 1000;
/** Kept past FRESH_UPLOAD_MS before a stored file counts as one no save can attach. */
const CLONE_SAFETY_MS = 5 * 60 * 1000;
/** Clone records one run looks at, and stored files it reads a page at a time. */
const CLONE_RECORDS_PER_RUN = 10;
const STORED_FILES_PER_PAGE = 200;
/**
 * What one stored file's checks may cost: nine index reads (every field
 * that can hold a file, and upload claims), their rows, and a delete. Kept
 * free before each, so a run stops and keeps its place before any limit.
 */
const FILE_CHECK_QUERIES = 16;
const FILE_CHECK_DOCUMENTS = 64;
const FILE_CHECK_BYTES = 1024 * 1024;
/** Files one run checks, and pages it reads, where the runtime cannot report its usage. */
const FILES_CHECKED_WITHOUT_METRICS = 100;
const PAGES_READ_WITHOUT_METRICS = 20;

/** Room in this transaction to check one more stored file, or (`page`) to read one more page of them. */
async function roomForFileCheck(
  ctx: MutationCtx,
  done: { checked: number; pages: number },
  page = false
): Promise<boolean> {
  try {
    const metrics = await ctx.meta.getTransactionMetrics();
    return (
      metrics.databaseQueries.remaining > FILE_CHECK_QUERIES &&
      metrics.documentsRead.remaining > FILE_CHECK_DOCUMENTS + (page ? STORED_FILES_PER_PAGE : 0) &&
      metrics.bytesRead.remaining > FILE_CHECK_BYTES &&
      metrics.documentsWritten.remaining > FILE_CHECK_DOCUMENTS &&
      metrics.bytesWritten.remaining > FILE_CHECK_BYTES
    );
  } catch {
    return done.checked < FILES_CHECKED_WITHOUT_METRICS && done.pages < PAGES_READ_WITHOUT_METRICS;
  }
}

/**
 * F2 review: deletes the clones runners stored but never attached. A clone
 * record still here means its runner stopped between storing a clone and
 * attaching it. Its window (the 15 minutes after it, when that clone can
 * have been stored) is looked at only once all of it is older than
 * FRESH_UPLOAD_MS and a margin, so no save can attach any file in it any
 * more. Any stored file there with the original's fingerprint and size that
 * no row holds and no upload claims is such a clone, or another orphan no
 * one can attach, and is deleted.
 *
 * Round 3: each file's checks are budgeted against the transaction's real
 * usage; before it would run out, the run saves its place in the record's
 * window (`scannedThrough`, the last file it finished) and says there is
 * more, for its own scheduled mutation to go on. A record goes only once
 * all of its window is read.
 */
export async function reconcileCopyClones(
  ctx: MutationCtx,
  now = Date.now()
): Promise<{ deleted: number; more: boolean }> {
  const safeBefore = now - FRESH_UPLOAD_MS - CLONE_SAFETY_MS;
  const stale = await ctx.db
    .query("projectCopyClones")
    .withIndex("by_startedAt", (q) => q.lt("startedAt", safeBefore - CLONE_WINDOW_MS))
    .take(CLONE_RECORDS_PER_RUN);
  let deleted = 0;
  const done = { checked: 0, pages: 0 };
  for (const record of stale) {
    const windowEnd = record.startedAt + CLONE_WINDOW_MS;
    let place = record.scannedThrough;
    /** Saves this record's place and stops: a fresh transaction goes on. */
    const pause = async () => {
      if (place !== record.scannedThrough) await ctx.db.patch(record._id, { scannedThrough: place });
      return { deleted, more: true };
    };
    for (;;) {
      // Round 4: before every page, each record's first included.
      if (!(await roomForFileCheck(ctx, done, true))) return await pause();
      const page = await ctx.db.system
        .query("_storage")
        .withIndex("by_creation_time", (q) =>
          place === undefined
            ? q.gte("_creationTime", record.startedAt).lte("_creationTime", windowEnd)
            : q.gt("_creationTime", place).lte("_creationTime", windowEnd)
        )
        .take(STORED_FILES_PER_PAGE);
      done.pages += 1;
      for (const file of page) {
        const matches = file._creationTime < safeBefore && file.sha256 === record.sha256 && file.size === record.size;
        if (matches) {
          if (!(await roomForFileCheck(ctx, done))) return await pause();
          done.checked += 1;
          if (!(await isStorageReferenced(ctx, file._id)) && !(await uploadClaimFor(ctx, file._id))) {
            await ctx.storage.delete(file._id);
            deleted += 1;
          }
        }
        place = file._creationTime;
      }
      if (page.length < STORED_FILES_PER_PAGE) break;
    }
    await ctx.db.delete(record._id);
  }
  return { deleted, more: stale.length === CLONE_RECORDS_PER_RUN };
}

/**
 * Ends a job before its end (the new project being erased, the copier's
 * access gone, a job that kept stalling): the job is marked failed and its
 * pending files "could not copy", a page at a time, so no draft waits on it.
 */
export async function stopProjectCopy(
  ctx: MutationCtx,
  job: Doc<"projectCopyJobs">,
  reason: string
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(job._id, {
    status: "failed",
    phase: undefined,
    cursorCreationTime: undefined,
    leaseToken: undefined,
    leaseUntil: undefined,
    stopReason: reason,
    updatedAt: now,
    finishedAt: now,
  });
  await failPendingCopyFiles(ctx, job._id);
}

/** Marks up to a page of a stopped job's pending files "could not copy"; schedules the next page. */
export async function failPendingCopyFiles(ctx: MutationCtx, jobId: Id<"projectCopyJobs">): Promise<number> {
  const pending = await ctx.db
    .query("projectDocuments")
    .withIndex("by_textCopyJobId_and_textCopyState", (q) => q.eq("textCopyJobId", jobId).eq("textCopyState", "pending"))
    .take(FAIL_PAGE);
  for (const doc of pending) await failCopiedFile(ctx, doc);
  if (pending.length === FAIL_PAGE) {
    await ctx.scheduler.runAfter(0, internal.projectDuplication.failStoppedCopyFiles, { jobId });
  }
  return pending.length;
}

/**
 * Takes up a job whose lease ran out (its runner crashed or was cut off):
 * a new lease, and the runner scheduled. A job that kept stalling is
 * stopped instead.
 */
export async function takeStalledProjectCopy(ctx: MutationCtx, job: Doc<"projectCopyJobs">): Promise<boolean> {
  const now = Date.now();
  if (job.status !== "preparing" && job.status !== "copying") return false;
  if (job.leaseUntil !== undefined && job.leaseUntil > now) return false;
  const resumes = (job.resumes ?? 0) + 1;
  if (resumes > PROJECT_COPY_MAX_RESUMES) {
    await stopProjectCopy(ctx, job, "stalled");
    return false;
  }
  const leaseToken = crypto.randomUUID();
  await ctx.db.patch(job._id, { leaseToken, leaseUntil: now + PROJECT_COPY_LEASE_MS, resumes, updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.projectDuplication.resumeProjectCopy, { jobId: job._id, leaseToken });
  return true;
}
