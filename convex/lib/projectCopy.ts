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
