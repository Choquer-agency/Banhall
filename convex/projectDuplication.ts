import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { domainError } from "./lib/contracts";
import {
  PROJECT_COPY_LEASE_MS,
  failPendingCopyFiles,
  takeStalledProjectCopy,
} from "./lib/projectCopy";

type CopyResult = {
  /**
   * The exact receipt (decision 65, stage 2): each copied file's source row
   * and the row it became, so the start dialog's leave-out list and any
   * lineage map by identity, never by file name and category.
   */
  documents: Array<{ sourceId: Id<"projectDocuments">; documentId: Id<"projectDocuments"> }>;
  previousYearReportId?: Id<"projectDocuments">;
  documentsCopied: number;
  filesCopied: number;
  transcriptOriginalsCopied: number;
  evidenceCopied: number;
  pdReviewsCopied: number;
  reportCopied: boolean;
  previousYearReportCopied: boolean;
};

/** What a run of the copy job did; `outcome` says how it ended. */
type RunTally = {
  documents: CopyResult["documents"];
  evidenceCopied: number;
  pdReviewsCopied: number;
  reportId?: Id<"reports">;
  previousYearReportId?: Id<"projectDocuments">;
  filesCopied: number;
  transcriptOriginalsCopied: number;
  outcome: "done" | "stopped" | "lease_lost" | "out_of_time";
};

/** The original's bytes cloned into new storage, or none when it cannot be read. */
async function cloneStoredFile(ctx: ActionCtx, storageId: Id<"_storage">): Promise<Id<"_storage"> | undefined> {
  try {
    const blob = await ctx.storage.get(storageId);
    return blob ? await ctx.storage.store(blob) : undefined;
  } catch (error) {
    // The file is copied without its original rather than not at all.
    console.warn(`project copy: an original file could not be read (${error instanceof Error ? error.name : "error"}); copied without it`);
    return undefined;
  }
}

/**
 * Runs a copy job from where it is (F2): the rest of the new project's
 * rows, then each pending file (its original cloned here, its text copied
 * whole in its own transaction), then the copied transcripts' originals.
 * Every step checks the job's lease; a step that finds another runner
 * holds it, or that the copy can no longer go on, ends the run. A clone the
 * mutation does not attach it releases itself; one made before a step
 * failed is released here.
 */
async function runProjectCopy(
  ctx: ActionCtx,
  jobId: Id<"projectCopyJobs">,
  leaseToken: string,
  tally: RunTally,
  stopAt?: number
): Promise<RunTally> {
  const outOfTime = () => stopAt !== undefined && Date.now() > stopAt;
  for (;;) {
    const step = await ctx.runMutation(internal.projects.continueProjectContentCopy, { jobId, leaseToken });
    const result = step.result;
    if (!result) {
      return { ...tally, outcome: step.kind === "lease_lost" ? "lease_lost" : step.kind === "finished" ? "done" : "stopped" };
    }
    tally.documents.push(...result.documents);
    tally.evidenceCopied = result.evidenceCopied;
    tally.pdReviewsCopied = result.pdReviewsCopied;
    if (result.reportId) tally.reportId = result.reportId;
    if (result.previousYearReportId) tally.previousYearReportId = result.previousYearReportId;
    if (result.prepared) break;
    if (outOfTime()) return { ...tally, outcome: "out_of_time" };
  }
  for (;;) {
    const next = await ctx.runQuery(internal.projects.nextProjectCopyFile, { jobId, leaseToken });
    if (!next) break;
    const clone = next.sourceStorageId ? await cloneStoredFile(ctx, next.sourceStorageId) : undefined;
    let outcome: "copied" | "failed" | "skipped" | "stopped";
    try {
      outcome = await ctx.runMutation(internal.projects.copyProjectFile, {
        jobId,
        leaseToken,
        documentId: next.documentId,
        ...(clone ? { cloneStorageId: clone } : {}),
      });
    } catch (error) {
      // Nothing points at the clone until the step commits.
      if (clone) await ctx.storage.delete(clone).catch(() => undefined);
      throw error;
    }
    if (outcome === "stopped") return { ...tally, outcome: "stopped" };
    if (outcome === "copied" && clone) tally.filesCopied += 1;
    if (outOfTime()) return { ...tally, outcome: "out_of_time" };
  }
  // Transcript originals (.docx, .vtt, .srt) come along too.
  const originals: Array<{ transcriptId: Id<"transcripts">; storageId: Id<"_storage"> }> = await ctx.runQuery(
    internal.projects.planTranscriptOriginalCopies,
    { jobId, leaseToken }
  );
  const transcriptCopies: Array<{ transcriptId: Id<"transcripts">; storageId: Id<"_storage"> }> = [];
  let finished: "done" | "files_left" | "stopped";
  try {
    for (const original of originals) {
      const clone = await cloneStoredFile(ctx, original.storageId);
      if (clone) transcriptCopies.push({ transcriptId: original.transcriptId, storageId: clone });
    }
    finished = await ctx.runMutation(internal.projects.finishProjectContentCopy, { jobId, leaseToken, transcriptCopies });
  } catch (error) {
    for (const copy of transcriptCopies) await ctx.storage.delete(copy.storageId).catch(() => undefined);
    throw error;
  }
  if (finished === "done") tally.transcriptOriginalsCopied += transcriptCopies.length;
  return { ...tally, outcome: finished === "done" ? "done" : finished === "stopped" ? "stopped" : "lease_lost" };
}

/** Waits, a second at a time, for another runner to finish the job (rare: this run's lease ran out). */
async function waitForProjectCopy(ctx: ActionCtx, jobId: Id<"projectCopyJobs">): Promise<void> {
  const until = Date.now() + 2 * PROJECT_COPY_LEASE_MS;
  while (Date.now() < until) {
    const status = await ctx.runQuery(internal.projectDuplication.projectCopyStatus, { jobId });
    if (status !== "preparing" && status !== "copying") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * The shared copy (F2): `projects.prepareProjectContentCopy` checks the
 * caller and the scope, starts the copy job and makes the new project's
 * rows; this action then runs the job to its end, so the duplicate wizard
 * and review from project (2026-08-11 second amendment) see a finished
 * copy, as before. Original file bytes are cloned, never shared. Only a
 * crash leaves files pending; the job then continues on its own.
 *
 * The mutations are internal (owner decision 35, 2026-09-25): every storage
 * id they attach was made here by `ctx.storage.store`.
 */
export async function copyProjectContentBetween(
  ctx: ActionCtx,
  args: {
    fromProjectId: Id<"projects">;
    toProjectId: Id<"projects">;
    targetTranscriptId?: Id<"transcripts">;
    /** Defaults to true; see projects.prepareProjectContentCopy. */
    includeReport?: boolean;
    /** Defaults to true; see projects.prepareProjectContentCopy. */
    includeReviews?: boolean;
    excludeDocumentIds?: Id<"projectDocuments">[];
    previousYearReport?: boolean;
    requireFreshTarget?: boolean;
  }
): Promise<CopyResult> {
  const plan = await ctx.runMutation(internal.projects.prepareProjectContentCopy, args);
  const tally = await runProjectCopy(ctx, plan.jobId, plan.leaseToken, {
    documents: [...plan.documents],
    evidenceCopied: plan.evidenceCopied,
    pdReviewsCopied: plan.pdReviewsCopied,
    ...(plan.reportId ? { reportId: plan.reportId } : {}),
    ...(plan.previousYearReportId ? { previousYearReportId: plan.previousYearReportId } : {}),
    filesCopied: 0,
    transcriptOriginalsCopied: 0,
    outcome: "done",
  });
  if (tally.outcome === "lease_lost") await waitForProjectCopy(ctx, plan.jobId);
  if (tally.outcome === "stopped") {
    domainError("INVALID_STATE", "The copy stopped before it finished: the new project is being deleted, or your access ended");
  }
  return {
    documents: tally.documents,
    ...(tally.previousYearReportId ? { previousYearReportId: tally.previousYearReportId } : {}),
    documentsCopied: tally.documents.length,
    filesCopied: tally.filesCopied,
    transcriptOriginalsCopied: tally.transcriptOriginalsCopied,
    evidenceCopied: tally.evidenceCopied,
    pdReviewsCopied: tally.pdReviewsCopied,
    reportCopied: tally.reportId !== undefined,
    previousYearReportCopied: tally.previousYearReportId !== undefined,
  };
}

/** A runner's time before it hands the job to a fresh action (an action may run 10 minutes). */
const RESUME_RUN_MS = 7 * 60 * 1000;

/** Continues a job whose first runner stopped (F2), under the lease it was given. */
export const resumeProjectCopy = internalAction({
  args: { jobId: v.id("projectCopyJobs"), leaseToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tally = await runProjectCopy(
      ctx,
      args.jobId,
      args.leaseToken,
      { documents: [], evidenceCopied: 0, pdReviewsCopied: 0, filesCopied: 0, transcriptOriginalsCopied: 0, outcome: "done" },
      Date.now() + RESUME_RUN_MS
    );
    if (tally.outcome === "out_of_time") {
      await ctx.runMutation(internal.projectDuplication.continueProjectCopyLater, args);
    }
    return null;
  },
});

/** Hands a job that is not finished to a fresh runner, keeping its lease (F2). */
export const continueProjectCopyLater = internalMutation({
  args: { jobId: v.id("projectCopyJobs"), leaseToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken || (job.status !== "preparing" && job.status !== "copying")) return null;
    await ctx.db.patch(job._id, { leaseUntil: Date.now() + PROJECT_COPY_LEASE_MS, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.projectDuplication.resumeProjectCopy, args);
    return null;
  },
});

/** Stalled jobs a cron run takes up, at most. */
const STALLED_JOBS_PER_RUN = 10;

/**
 * Cron (F2): takes up copy jobs whose lease ran out (their runner crashed
 * or was cut off), so none is left half done and no draft waits on one.
 */
export const resumeStalledProjectCopies = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let taken = 0;
    for (const status of ["preparing", "copying"] as const) {
      const stalled = await ctx.db
        .query("projectCopyJobs")
        .withIndex("by_status_and_leaseUntil", (q) => q.eq("status", status).lt("leaseUntil", now))
        .take(STALLED_JOBS_PER_RUN);
      for (const job of stalled) if (await takeStalledProjectCopy(ctx, job)) taken += 1;
    }
    return taken;
  },
});

/** The next page of a stopped job's pending files, marked "could not copy" (F2). */
export const failStoppedCopyFiles = internalMutation({
  args: { jobId: v.id("projectCopyJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await failPendingCopyFiles(ctx, args.jobId);
    return null;
  },
});

/** A job's status, for an action waiting on another runner (F2). */
export const projectCopyStatus = internalQuery({
  args: { jobId: v.id("projectCopyJobs") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => (await ctx.db.get(args.jobId))?.status ?? null,
});

/**
 * Copies the project input package after the duplicate wizard creates its
 * destination project. Original file bytes are cloned rather than sharing
 * storage ids, so deleting a document from either project cannot break the
 * other copy.
 *
 * The plain duplicate is a full clone. A duplicate made to draft again (the
 * card Duplicate, 2026-09-25) passes `includeReport: false`, and
 * `includeReviews: false` unless it is a Review PD project, so the new
 * project holds only the inputs its own generation will read.
 *
 * Owner decision 35 (2026-09-25): the writer can untick files
 * (`excludeDocumentIds`), a year-over-year duplicate can bring the old report
 * in as last year's report (`previousYearReport`), and the copy only ever
 * writes into a project the caller has just created.
 */
export const copyProjectContent = action({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
    // Absent when the duplicate carries no transcript at all: the report copy
    // simply has no source transcript to cite.
    targetTranscriptId: v.optional(v.id("transcripts")),
    includeReport: v.optional(v.boolean()),
    includeReviews: v.optional(v.boolean()),
    excludeDocumentIds: v.optional(v.array(v.id("projectDocuments"))),
    previousYearReport: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CopyResult> => {
    return await copyProjectContentBetween(ctx, { ...args, requireFreshTarget: true });
  },
});
