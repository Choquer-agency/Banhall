import { action, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { domainError } from "./lib/contracts";
import {
  PROJECT_COPY_LEASE_MS,
  failPendingCopyFiles,
  reconcileCopyClones,
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
  /** F2 review: originals whose bytes could not be read; their files or transcripts came without one. */
  originalsNotCopied: number;
  /**
   * F2 review: the copy goes on after this action (it ran out of time, or
   * another runner holds it); the receipt lists the rows made so far, and
   * the files still being copied show so in the new project.
   */
  stillCopying?: true;
};

/** How a run of the copy job ended. */
type RunEnd = "done" | "stopped" | "lease_lost" | "out_of_time";

/**
 * Round 3: the time one clone of an original is allowed to take. A runner
 * starts a clone, or a second attempt of one, only while at least this much
 * of its time is left, so, with a run of 7 minutes, a clone of up to 6
 * minutes still ends inside an action's 10 and the runner hands the copy
 * on. Storage calls cannot be stopped: a clone that takes longer ends its
 * action at the limit, and the cron takes the copy up again under a new
 * lease (its stray clone is removed by `reconcileCopyClones`).
 */
const MAX_CLONE_MS = 3 * 60 * 1000;

/**
 * The original's bytes cloned into new storage. Tried twice; `unreadable`
 * when both failed, so the file is copied without its original and the
 * copy says so. No clone and not unreadable: the original is gone.
 */
async function cloneStoredFile(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
  /** Round 4: whether the runner still has time for a second attempt. */
  mayRetry: () => boolean
): Promise<{ clone?: Id<"_storage">; unreadable: boolean; retryLater?: true }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const blob = await ctx.storage.get(storageId);
      return blob ? { clone: await ctx.storage.store(blob), unreadable: false } : { unreadable: false };
    } catch (error) {
      // No time for the second attempt: the next runner tries again.
      if (attempt === 1 && !mayRetry()) return { unreadable: false, retryLater: true };
      if (attempt >= 2) {
        console.warn(`project copy: an original file could not be read (${error instanceof Error ? error.name : "error"}); copied without it`);
        return { unreadable: true };
      }
    }
  }
}

/**
 * Runs a copy job from where it is (F2): the rest of the new project's
 * rows, then each pending file (its original cloned here, under a clone
 * record, its text copied whole in its own transaction), then the copied
 * transcripts' originals. Every step checks the job's lease. A file whose
 * step throws is counted and tried once more, then given up. Stops at
 * `stopAt` between files, for the caller to hand the job on.
 */
async function runProjectCopy(
  ctx: ActionCtx,
  jobId: Id<"projectCopyJobs">,
  leaseToken: string,
  stopAt: number
): Promise<RunEnd> {
  const lease = { jobId, leaseToken };
  const outOfTime = () => Date.now() > stopAt;
  const roomForClone = () => stopAt - Date.now() >= MAX_CLONE_MS;
  for (;;) {
    const step = await ctx.runMutation(internal.projects.continueProjectContentCopy, lease);
    const result = step.result;
    if (!result) return step.kind === "lease_lost" ? "lease_lost" : step.kind === "finished" ? "done" : "stopped";
    if (result.prepared) break;
    if (outOfTime()) return "out_of_time";
  }
  for (;;) {
    if (outOfTime()) return "out_of_time";
    const next = await ctx.runQuery(internal.projects.nextProjectCopyFile, lease);
    if (!next) break;
    let clone: Id<"_storage"> | undefined;
    let cloneRecordId: Id<"projectCopyClones"> | null = null;
    let originalNotCopied = false;
    if (next.sourceStorageId) {
      if (!roomForClone()) return "out_of_time";
      cloneRecordId = await ctx.runMutation(internal.projects.beginProjectCopyClone, {
        ...lease,
        sourceStorageId: next.sourceStorageId,
      });
      if (cloneRecordId) {
        const cloned = await cloneStoredFile(ctx, next.sourceStorageId, roomForClone);
        if (cloned.retryLater) return "out_of_time";
        clone = cloned.clone;
        originalNotCopied = cloned.unreadable;
      }
    }
    let outcome: "copied" | "failed" | "skipped" | "stopped" | "lease_lost";
    try {
      outcome = await ctx.runMutation(internal.projects.copyProjectFile, {
        ...lease,
        documentId: next.documentId,
        ...(clone ? { cloneStorageId: clone } : {}),
        ...(cloneRecordId ? { cloneRecordId } : {}),
        ...(originalNotCopied ? { originalNotCopied: true } : {}),
      });
    } catch (error) {
      // Nothing points at the clone until the step commits; its record is
      // left for the cron, which finds nothing to delete and drops it.
      if (clone) await ctx.storage.delete(clone).catch(() => undefined);
      console.warn(`project copy: a file's copy step failed (${error instanceof Error ? error.name : "error"})`);
      const noted = await ctx.runMutation(internal.projects.noteProjectCopyFileError, {
        ...lease,
        documentId: next.documentId,
      });
      if (noted === "lease_lost" || noted === "stopped") return noted;
      continue;
    }
    if (outcome === "stopped" || outcome === "lease_lost") return outcome;
  }
  // Transcript originals (.docx, .vtt, .srt) come along too, each attached
  // in its own step, with the runner's time checked between them.
  const originals: Array<{ transcriptId: Id<"transcripts">; storageId: Id<"_storage"> }> = await ctx.runQuery(
    internal.projects.planTranscriptOriginalCopies,
    lease
  );
  for (const original of originals) {
    if (!roomForClone()) return "out_of_time";
    const cloneRecordId = await ctx.runMutation(internal.projects.beginProjectCopyClone, {
      ...lease,
      sourceStorageId: original.storageId,
    });
    const cloned = cloneRecordId
      ? await cloneStoredFile(ctx, original.storageId, roomForClone)
      : { unreadable: false };
    if ("retryLater" in cloned && cloned.retryLater) return "out_of_time";
    let step: "attached" | "skipped" | "stopped" | "lease_lost";
    try {
      step = await ctx.runMutation(internal.projects.copyTranscriptOriginal, {
        ...lease,
        transcriptId: original.transcriptId,
        ...(cloned.clone ? { cloneStorageId: cloned.clone } : {}),
        ...(cloneRecordId ? { cloneRecordId } : {}),
        ...(cloned.unreadable ? { originalNotCopied: true } : {}),
      });
    } catch (error) {
      if (cloned.clone) await ctx.storage.delete(cloned.clone).catch(() => undefined);
      throw error;
    }
    if (step === "stopped" || step === "lease_lost") return step;
  }
  const finished = await ctx.runMutation(internal.projects.finishProjectContentCopy, { ...lease, transcriptCopies: [] });
  // Files still pending at the end (another step left one): a fresh runner takes it on.
  return finished === "files_left" ? "out_of_time" : finished;
}

/** Polls, a second at a time until `until`, for another runner to finish the job. */
async function waitForProjectCopy(ctx: ActionCtx, jobId: Id<"projectCopyJobs">, until: number): Promise<void> {
  while (Date.now() < until) {
    const status = await ctx.runQuery(internal.projectDuplication.projectCopyStatus, { jobId });
    if (status !== "preparing" && status !== "copying") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** The first runner's time, from the action's start, before it hands the job on (an action may run 10 minutes). */
const FIRST_RUN_MS = 7 * 60 * 1000;
/** Until when, from the action's start, it waits for another runner holding the job. */
const WAIT_FOR_RUNNER_MS = 8 * 60 * 1000;

/**
 * The shared copy (F2): the files to leave out are checked first, page by
 * page; `projects.prepareProjectContentCopy` checks the caller and the
 * scope, starts the copy job and makes the new project's rows; this action
 * then runs the job. The duplicate wizard and review from project
 * (2026-08-11 second amendment) see a finished copy, as before; a copy too
 * long for one action is handed on and comes back `stillCopying`. The
 * result is read from what the copy wrote, so it is the same whichever
 * runner did the work. Original file bytes are cloned, never shared.
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
  const started = Date.now();
  if (args.excludeDocumentIds && args.excludeDocumentIds.length > 0) {
    for (let from: number | null = 0; from !== null; ) {
      const page: { next: number | null } = await ctx.runQuery(internal.projects.checkCopyExclusions, {
        fromProjectId: args.fromProjectId,
        excludeDocumentIds: args.excludeDocumentIds,
        from,
      });
      from = page.next;
    }
  }
  const plan = await ctx.runMutation(internal.projects.prepareProjectContentCopy, args);
  const lease = { jobId: plan.jobId, leaseToken: plan.leaseToken };
  const end = await runProjectCopy(ctx, plan.jobId, plan.leaseToken, started + FIRST_RUN_MS);
  if (end === "out_of_time") await ctx.runMutation(internal.projectDuplication.continueProjectCopyLater, lease);
  if (end === "lease_lost") await waitForProjectCopy(ctx, plan.jobId, started + WAIT_FOR_RUNNER_MS);
  const outcome = await ctx.runQuery(internal.projects.projectCopyOutcome, { jobId: plan.jobId });
  if (!outcome || outcome.status === "failed" || end === "stopped") {
    domainError("INVALID_STATE", "The copy stopped before it finished: the new project is being deleted, or your access ended");
  }
  return {
    documents: outcome.documents,
    ...(outcome.previousYearReportId ? { previousYearReportId: outcome.previousYearReportId } : {}),
    documentsCopied: outcome.documents.length,
    filesCopied: outcome.originalsAttached,
    transcriptOriginalsCopied: outcome.transcriptOriginalsAttached,
    evidenceCopied: outcome.evidenceCopied,
    pdReviewsCopied: outcome.pdReviewsCopied,
    reportCopied: outcome.reportId !== undefined,
    previousYearReportCopied: outcome.previousYearReportId !== undefined,
    originalsNotCopied: outcome.originalsNotCopied,
    ...(outcome.status !== "done" ? { stillCopying: true as const } : {}),
  };
}

/** A runner's time before it hands the job to a fresh action. */
const RESUME_RUN_MS = 7 * 60 * 1000;

/** Continues a job whose first runner stopped (F2), under the lease it was given. */
export const resumeProjectCopy = internalAction({
  args: { jobId: v.id("projectCopyJobs"), leaseToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const end = await runProjectCopy(ctx, args.jobId, args.leaseToken, Date.now() + RESUME_RUN_MS);
    if (end === "out_of_time") {
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

/**
 * Cron (F2 review, round 3): deletes the clones stopped runners stored but
 * never attached (`reconcileCopyClones`), in its own transaction, never in
 * the recovery's. It goes on in a fresh one while there is more to read.
 */
export const reconcileProjectCopyClones = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const { deleted, more } = await reconcileCopyClones(ctx);
    if (more) await ctx.scheduler.runAfter(0, internal.projectDuplication.reconcileProjectCopyClones, {});
    return deleted;
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
